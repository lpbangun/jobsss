"""Small Exa boundary. No keys in files, logs or exceptions; no POST retry."""
from datetime import datetime, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def exa_http(method, path, payload, key):
    request = Request('https://api.exa.ai' + path,
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers={'x-api-key': key, 'Content-Type': 'application/json', 'Accept': 'application/json'},
                      method=method)
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f'Exa HTTP {exc.code}; no automatic retry') from None
    except (URLError, TimeoutError, ValueError):
        raise RuntimeError('Exa transport/JSON failure; check journal before retrying') from None


def exa_run(auth, journal, *, key=None, transport=exa_http, polls=12, interval=5):
    key = os.environ.get('EXA_API_KEY', '') if key is None else key
    cap = Decimal(str(auth.get('max_total_usd', 0)))
    if (auth.get('approved') is not True or not str(auth.get('name', '')).strip()
            or not str(auth.get('company', '')).strip() or not key or not cap.is_finite()
            or not Decimal('0.045') <= cap <= Decimal('0.05')
            or auth.get('effort', 'low') != 'low'):
        raise ValueError('Requires named contact, approval, EXA_API_KEY, low effort and allowance $0.045–$0.05')
    # Fixed low effort + at most one email; allowance is not a provider hard cap.
    payload = {'query': 'Find a professional email only for this already identified person at the supplied company. '
                       'Return at most one professional email, only if attributable; do not guess. '
                       'Cite email attribution sources. Return null if uncertain. No social discovery, activity research, '
                       'dossiers, phone numbers, mailbox verification or unrelated enrichment.',
               'input': {'data': [{'name': auth['name'], 'company': auth['company']}]},
               # Exa Connect partner selection is the `dataSources` array (Exa Agent API);
               # the Fiber datasource is required for this route, so it is part of the
               # journaled request fingerprint: a journal written without it is refused,
               # never resumed into a silently different run.
               'dataSources': [{'provider': 'fiber'}],
               'effort': 'low',
               'outputSchema': {'type': 'object', 'properties': {
                   'email': {'type': 'string', 'format': 'email'},
                   'email_attribution': {'type': 'string'},
                   'source_urls': {'type': 'array', 'maxItems': 5, 'items': {'type': 'string', 'format': 'uri'}}}}}
    journal = Path(journal)
    journal.parent.mkdir(parents=True, exist_ok=True)
    if journal.exists():
        state = json.loads(journal.read_text())
        if state.get('request') != payload:
            raise ValueError('Journal belongs to a different request; do not reuse it')
        run = state.get('run')
        if not run:
            raise ValueError('Uncertain prior dispatch; reconcile manually, never repeat POST blindly')
    else:
        state = {'request': payload, 'dispatch': 'uncertain', 'fetched_at': None}
        # Exclusive creation is a persistent duplicate-dispatch guard, including crashes.
        with journal.open('x') as file:
            json.dump(state, file, indent=2)
        run = transport('POST', '/agent/runs', payload, key)
        state['run'] = run
        state['dispatch'] = 'created'
        journal.write_text(json.dumps(state, indent=2))
    for _ in range(polls):
        if run.get('status') in ('completed', 'failed', 'cancelled'):
            break
        run_id = run.get('id', '')
        if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,200}', run_id):
            raise ValueError('Malformed run id; journal retained')
        if interval:
            time.sleep(interval)
        run = transport('GET', '/agent/runs/' + run_id, None, key)
        state['run'] = run
        state['fetched_at'] = datetime.now(timezone.utc).isoformat()
        journal.write_text(json.dumps(state, indent=2))
    return run


def aftership_run(address, authorization, *, adapter, smtp=False, timeout=20):
    """Explicit address-scoped dispatch; adapter path is trusted local code."""
    if (authorization.get('approved') is not True
            or authorization.get('address') != address
            or not address or not isinstance(address, str)
            or (smtp and authorization.get('smtp_approved') is not True)):
        raise ValueError('Exact address approval required; SMTP needs separate approval')
    import subprocess
    if not isinstance(timeout, (int, float)) or not 0 < timeout <= 60:
        raise ValueError('Timeout must be in (0, 60] seconds')
    raw, error = {}, None
    try:
        run = subprocess.run([str(Path(adapter).resolve())], input=json.dumps({
            'address': address, 'approved': True, 'smtp': smtp,
            'smtp_approved': authorization.get('smtp_approved') is True,
            'timeout_seconds': timeout}), text=True, capture_output=True, timeout=timeout + 1)
        if run.returncode:
            raise ValueError('Adapter failed')
        response = json.loads(run.stdout)
        if (not isinstance(response, dict) or response.get('smtp_enabled') is not smtp
                or not isinstance(response.get('raw'), dict)
                or response['raw'].get('email') != address):
            raise ValueError('Invalid adapter envelope')
        raw, error = response['raw'], response.get('error')
        if not isinstance(raw.get('syntax'), dict) or not isinstance(raw.get('smtp') or {}, dict):
            raise ValueError('Invalid adapter result')
    except (OSError, subprocess.TimeoutExpired, ValueError):
        raw, error = {}, 'adapter_error_or_timeout'
    checked_at = datetime.now(timezone.utc).isoformat()
    return {'address': address, 'raw': raw, 'error': error,
            'smtp_enabled': smtp, 'mailbox': aftership_result(raw, checked_at, smtp, error=error)}


def aftership_result(raw, checked_at, smtp_enabled=False, *, error=None):
    """Normalize actual AfterShip JSON, never infer identity from a mailbox."""
    status = 'unknown'
    detail = 'No conclusive mailbox result; MX alone does not verify a mailbox.'
    smtp = raw.get('smtp') or {}
    if error:
        detail = 'Verifier timeout/error/blocked; mailbox status remains unknown.'
    elif raw.get('syntax', {}).get('valid') is False:
        status, detail = 'invalid', 'Verifier reported invalid address syntax.'
    elif smtp_enabled and smtp:
        if smtp.get('catch_all') or smtp.get('full_inbox'):
            status, detail = 'risky', 'Catch-all or full inbox; do not treat as verified.'
        elif smtp.get('disabled'):
            status, detail = 'rejected', 'Verifier reported disabled mailbox; not identity evidence.'
        elif (smtp.get('host_exists') is True and smtp.get('deliverable') is True
              and smtp.get('catch_all') is False and smtp.get('full_inbox') is False
              and smtp.get('disabled') is False):
            status, detail = 'smtp_accepted', 'SMTP recipient accepted; not a delivery guarantee or identity proof.'
    return {'status': status, 'method': 'aftership_smtp' if smtp_enabled else 'aftership_dns',
            'checked_at': checked_at, 'detail': detail}

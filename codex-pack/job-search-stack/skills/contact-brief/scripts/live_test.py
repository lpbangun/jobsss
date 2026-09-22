"""Opt-in Exa execution and an offline evidence gate, not a browser orchestrator."""
import argparse
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import sys

from cb_providers import exa_run
from contact_brief import acceptance, validate


def preflight(auth):
    blockers = []
    if not auth or auth.get('approved') is not True or not auth.get('name') or not auth.get('company'):
        blockers.append('named contact and explicit approval')
    try:
        cap = Decimal(str((auth or {}).get('max_total_usd', 0)))
        if not cap.is_finite() or not Decimal('0.045') <= cap <= Decimal('0.05') or (auth or {}).get('effort', 'low') != 'low':
            blockers.append('low effort and approved allowance $0.045–$0.05 required (not a provider hard cap)')
    except InvalidOperation:
        blockers.append('invalid budget')
    if not os.environ.get('EXA_API_KEY'):
        blockers.append('EXA_API_KEY missing')
    return {'passed': not blockers, 'blockers': blockers, 'network_calls': 0}


def verify_evidence(brief, evidence_root, exa_journal):
    validate(brief)
    blockers = list(acceptance(brief)['blockers'])
    root = Path(evidence_root).resolve()
    for platform, coverage in brief['coverage'].items():
        for action in coverage['actions']:
            file = (root / action['evidence_file']).resolve()
            if root not in file.parents or not file.is_file() or not file.stat().st_size:
                blockers.append(f'{platform}: missing or unsafe evidence file')
    if not exa_journal or exa_journal.get('run', {}).get('status') != 'completed':
        blockers.append('Exa live completion evidence missing')
    elif exa_journal.get('request', {}).get('input', {}).get('data') != [brief['subject']]:
        blockers.append('Exa identity input does not match brief subject')
    elif not exa_journal.get('run', {}).get('output', {}).get('grounding'):
        blockers.append('Exa source grounding missing')
    if brief['email']['address'] and brief['email']['mailbox']['method'] != 'aftership_smtp':
        blockers.append('Enabled real SMTP check evidence missing for found address')
    if not brief['draft']:
        blockers.append('Evidence-backed draft with supplied candidate facts missing')
    return {'passed': False, 'evidence_complete': not blockers,
            'blockers': blockers + ['Live execution cannot be attested from supplied files'],
            'live_execution': 'not_verified', 'network_calls': 0,
            'scope': 'Recorded evidence completeness only; this command performs no browser or mailbox execution'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'exa', 'verify'])
    parser.add_argument('--authorization', type=Path)
    parser.add_argument('--journal', type=Path)
    parser.add_argument('--brief', type=Path)
    parser.add_argument('--evidence-root', type=Path, default=Path('.'))
    parser.add_argument('--execute', action='store_true', help='Explicit paid Exa opt-in; not implicit in preflight')
    args = parser.parse_args()
    try:
        auth = json.loads(args.authorization.read_text()) if args.authorization else None
        if args.command == 'verify':
            if not args.brief:
                parser.error('verify requires --brief')
            report = verify_evidence(json.loads(args.brief.read_text()), args.evidence_root,
                                     json.loads(args.journal.read_text()) if args.journal else None)
        else:
            report = preflight(auth)
            if args.command == 'exa':
                if not args.execute:
                    report['passed'] = False
                    report['blockers'].append('--execute required for a paid call')
                if not args.journal:
                    report['passed'] = False
                    report['blockers'].append('--journal required for duplicate prevention')
                if report['passed']:
                    run = exa_run(auth, args.journal)
                    report = {'passed': run.get('status') == 'completed', 'status': run.get('status'),
                              'journal': str(args.journal), 'costDollars': run.get('costDollars'),
                              'note': 'Provider result only; native social acceptance still required. Pending runs may continue incurring cost; resume same journal.'}
        print(json.dumps(report, indent=2))
        return 0 if report['passed'] else 2
    except (ValueError, OSError, RuntimeError) as exc:
        print(json.dumps({'passed': False, 'blockers': [f'{type(exc).__name__}: operation failed; inspect journal, do not blindly redispatch']}))
        return 2


if __name__ == '__main__':
    sys.exit(main())

"""Explicit M12 migration preview. Inputs are never overwritten implicitly."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path


def migrate_rules(source):
    result = copy.deepcopy(source)
    if result.get('schemaVersion') != 5:
        raise ValueError('Expected rule schemaVersion 5')
    if result.get('form') not in ('graph', 'grid', 'laneGraph'):
        raise ValueError('Unsupported rule form')
    result['schemaVersion'] = 6
    for symbol in result.get('symbols', []):
        for i, compartment in enumerate(symbol.get('compartments', []), 1):
            if 'id' in compartment:
                raise ValueError('Unexpected preexisting compartment ID')
            compartment['id'] = f'compartment-{i}'
    return result


def migrate_presentation(source, compatibility):
    if source.get('schemaVersion') != 2:
        raise ValueError('Expected presentation schemaVersion 2')
    result = copy.deepcopy(source)
    result['schemaVersion'] = 3
    for key, view in result['views'].items():
        selected = compatibility.get(key)
        form = view.get('form')
        inventory = 'positions' if form == 'graph' else 'lanes' if form == 'laneGraph' else None
        if not inventory or not selected or set(selected) != {'packageFingerprint', 'projection', inventory}:
            raise ValueError(f'Explicit compatibility identity required for view {key}')
        if len(selected['packageFingerprint']) != 64 or not all(c in '0123456789abcdef' for c in selected['packageFingerprint']):
            raise ValueError('Expected lowercase SHA-256 package fingerprint')
        if not isinstance(selected['projection'], str) or not selected['projection']:
            raise ValueError('Expected projection ID')
        if form == 'graph':
            if set(view) != {'form','positions','viewport'} or not isinstance(selected['positions'],dict):
                raise ValueError('Invalid graph presentation/inventory')
            unmatched = sorted(set(view['positions']) - set(selected['positions']))
            if unmatched:
                raise ValueError(f'Unmatched geometry in {key}: {unmatched}')
            for identity, geometry in view['positions'].items():
                if set(geometry) != {'x','y','width','height'} or not all(isinstance(n,(int,float)) and not isinstance(n,bool) and math.isfinite(n) for n in geometry.values()):
                    raise ValueError('Invalid legacy geometry')
                minimum = selected['positions'][identity]
                if set(minimum) != {'width','height'} or not all(isinstance(n,(int,float)) and not isinstance(n,bool) and math.isfinite(n) and 1 <= n <= 1000000 for n in minimum.values()):
                    raise ValueError('Invalid current measured minimum')
                if geometry['width'] < 1 or geometry['height'] < 1 or abs(geometry['x']) > 1000000 or abs(geometry['y']) > 1000000:
                    raise ValueError('Invalid legacy position extent')
                geometry['width'] = max(geometry['width'],minimum['width'])
                geometry['height'] = max(geometry['height'],minimum['height'])
        else:
            if set(view) != {'form','laneOrder','viewport'} or not isinstance(selected['lanes'],list) or len(set(selected['lanes'])) != len(selected['lanes']):
                raise ValueError('Invalid lane compatibility inventory')
            if len(set(view['laneOrder'])) != len(view['laneOrder']) or set(view['laneOrder']) - set(selected['lanes']):
                raise ValueError('Unmatched or duplicate lane IDs')
        viewport = view['viewport']
        if set(viewport) != {'x','y','zoom'} or not all(isinstance(n,(int,float)) and not isinstance(n,bool) and math.isfinite(n) for n in viewport.values()) or not .05 <= viewport['zoom'] <= 4:
            raise ValueError('Invalid legacy viewport')
        view.update({k:selected[k] for k in ['packageFingerprint','projection']})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['rules', 'presentation'])
    parser.add_argument('input', type=Path)
    parser.add_argument('--compatibility', type=Path)
    parser.add_argument('--output', type=Path, help='Explicit new destination; must not exist')
    args = parser.parse_args()
    original = args.input.read_bytes()
    if len(original) > 16 * 1024 * 1024:
        raise ValueError('Migration input exceeds 16 MiB')
    source = json.loads(original)
    result = migrate_rules(source) if args.kind == 'rules' else migrate_presentation(source, json.loads(args.compatibility.read_bytes()) if args.compatibility else {})
    encoded = (json.dumps(result, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
    changes = []
    if args.kind == 'presentation':
        for key, view in result['views'].items():
            for identity, geometry in view.get('positions',{}).items():
                before = source['views'][key]['positions'][identity]
                if before != geometry:
                    changes.append(dict(view=key,position=identity,before=before,after=geometry))
    preview = dict(input=str(args.input), originalSha256=hashlib.sha256(original).hexdigest(), candidateSha256=hashlib.sha256(encoded).hexdigest(), geometryChanges=changes, candidate=result)
    if args.output:
        if args.output.resolve() == args.input.resolve():
            raise ValueError('Migration must preserve the original input')
        with args.output.open('xb') as stream:
            stream.write(encoded)
    print(json.dumps(preview, ensure_ascii=False))


if __name__ == '__main__':
    main()

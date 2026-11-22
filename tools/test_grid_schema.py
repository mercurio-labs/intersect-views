"""Structural schema checks; Rust/TS validators additionally enforce grid invariants."""
from pathlib import Path
import json
import jsonschema
from referencing import Registry, Resource
ROOT = Path(__file__).resolve().parents[1] / 'crates' / 'intersect-views'
def retrieve(uri):
    name = uri.rsplit('/', 1)[-1]
    if not name.endswith('.schema.json') or '/' in name or '\\' in name:
        raise ValueError('Only local schema references are supported')
    return Resource.from_contents(json.loads((ROOT / name).read_text(encoding='utf-8')))
registry = Registry(retrieve=retrieve)
fixtures = json.loads((ROOT / 'tests/fixtures/grid-v7-accepted-m14.json').read_text(encoding='utf-8'))
count = 0
for fixture in fixtures:
    value = fixture['value']
    if value.get('form') == 'graph':
        continue
    name = {'scene':'grid', 'rules':'grid-rule-set', 'targets':'grid-targets'}[fixture['kind']]
    schema = json.loads((ROOT / (name + '.schema.json')).read_text(encoding='utf-8'))
    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.Draft202012Validator(schema, registry=registry).validate(value)
    count += 1
print(f'{count} accepted grid fixtures pass JSON Schema; cross-field invariants use shared Rust/TS vectors.')

# Graph additions share the exact source-binding and document schemas.
schema = json.loads((ROOT / 'graph.schema.json').read_text(encoding='utf-8'))
jsonschema.Draft202012Validator.check_schema(schema)
validator = jsonschema.Draft202012Validator(schema, registry=registry)
for name in ['scene-v6-m14.json', 'graph-m12-m14.json']:
    validator.validate(json.loads((ROOT / 'tests/fixtures' / name).read_text(encoding='utf-8')))
print('2 accepted v7 graph fixtures pass JSON Schema; identities/context/byte limits use Rust/TS validators.')

for schema_name, fixture in [('lane-graph','lane-scene-v6-m14'),('lane-rule-set','lane-rules-v7-m14'),('lane-targets','lane-targets-v1'),('presentation','presentation-v4')]:
    schema = json.loads((ROOT / (schema_name + '.schema.json')).read_text(encoding='utf-8'))
    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.Draft202012Validator(schema, registry=registry).validate(json.loads((ROOT / 'tests/fixtures' / (fixture + '.json')).read_text(encoding='utf-8')))
print('v7 lane scene / v8 rules, v1 targets and presentation v4 pass structural schemas; shared native/TS validators enforce cross-field constraints.')

for schema_name, fixture in [('graph','scene-v5'),('lane-graph','lane-scene-v5'),('lane-rule-set','lane-rules-v5'),('presentation','presentation-v2')]:
    schema=json.loads((ROOT/(schema_name+'.schema.json')).read_text(encoding='utf-8'))
    try:
        jsonschema.Draft202012Validator(schema,registry=registry).validate(json.loads((ROOT/'tests/fixtures'/(fixture+'.json')).read_text(encoding='utf-8')))
    except jsonschema.ValidationError:
        continue
    raise AssertionError('Accepted legacy '+fixture)
print('Legacy graph/lane v5 and presentation v2 are explicitly refused.')

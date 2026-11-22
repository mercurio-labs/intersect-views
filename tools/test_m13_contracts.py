"""M13 schema and explicit migration boundary checks; no language emulation."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import jsonschema
from referencing import Registry, Resource
ROOT=Path(__file__).resolve().parents[1]
CONTRACTS=ROOT/'crates/intersect-views'
FIXTURES=CONTRACTS/'tests/fixtures'
def read(path):return json.loads(path.read_text(encoding='utf-8'))
class Contracts(unittest.TestCase):
    def test_rendering_schemas(self):
        schemas={p.name:dict({'$schema':'https://json-schema.org/draft/2020-12/schema'},**read(p)) for p in CONTRACTS.glob('*.schema.json')}
        registry=Registry().with_resources((name,Resource.from_contents(schema)) for name,schema in schemas.items())
        for name in ['rendering-registry.schema.json','rendering-resolution.schema.json']:jsonschema.Draft202012Validator.check_schema(schemas[name])
        cases=read(FIXTURES/'rendering-v1.json')
        for case in cases['accepted']:
            name='rendering-registry.schema.json' if case['kind']=='registry' else 'rendering-resolution.schema.json'
            jsonschema.Draft202012Validator(schemas[name],registry=registry).validate(case['value'])
        for case in cases['rejected']:
            # Rule references, duplicates and UTF-8 byte limits are checked by the
            # shared Rust/TS fixtures. These cases are structurally decidable.
            if case['name'] in ['unqualified selection registration','required nullable target'] or case['name'].startswith('empty registration segment'):
                name='rendering-registry.schema.json' if case['kind']=='registry' else 'rendering-resolution.schema.json'
                with self.assertRaises(jsonschema.ValidationError,msg=case['name']):jsonschema.Draft202012Validator(schemas[name],registry=registry).validate(case['value'])
    def test_explicit_rule_migration_preserves_source_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'v6.json';destination=Path(directory)/'v7.json'
            original=(FIXTURES/'rule-set-v6.json').read_bytes();source.write_bytes(original)
            command=['node','--experimental-strip-types',str(ROOT/'tools/migrate_rules_v7.mjs'),str(source)]
            preview=json.loads(subprocess.check_output(command,encoding='utf-8'))
            self.assertEqual(preview['originalSha256'],hashlib.sha256(original).hexdigest())
            self.assertEqual(preview['candidate']['schemaVersion'],7)
            self.assertEqual(preview['candidate']['projection'],{'kind':'nested'})
            subprocess.run(command+['--output',str(destination)],check=True,capture_output=True)
            for path in [source,destination]:self.assertNotEqual(subprocess.run(command+['--output',str(path)],capture_output=True).returncode,0)
            self.assertEqual(source.read_bytes(),original)
            self.assertEqual(read(destination),preview['candidate'])
if __name__=='__main__':unittest.main()

"""Schema and migration checks for the M12 wire boundary."""
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import jsonschema
from referencing import Registry, Resource
from migrate_m12 import migrate_rules, migrate_presentation
ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT/'crates/intersect-views'
FIXTURES = CONTRACTS/'tests/fixtures'
def load(path):
    return json.loads(path.read_text(encoding='utf-8'))
class Contracts(unittest.TestCase):
    def test_schemas(self):
        schemas={p.name:load(p) for p in CONTRACTS.glob('*.schema.json')}
        registry=Registry().with_resources((name,Resource.from_contents(s)) for name,s in schemas.items())
        def validate(name,value):
            jsonschema.Draft202012Validator(schemas[name],registry=registry).validate(value)
        for name,s in schemas.items():
            jsonschema.Draft202012Validator.check_schema(s)
        validate('graph.schema.json',load(FIXTURES/'scene-v6.json'))
        validate('graph.schema.json',load(FIXTURES/'graph-m12.json'))
        validate('presentation.schema.json',load(FIXTURES/'presentation-v3.json'))
        validate('graph-rule-set.schema.json',load(FIXTURES/'rule-set-v7.json'))
        validate('graph-rule-set.schema.json',load(ROOT/'harness/views/symbols/symbols.viewrules.json'))
        for p in (ROOT/'harness/views/symbols').glob('*.symbols.json'):
            validate('graphics.schema.json',load(p))
        for v in load(FIXTURES/'graphics-v1.json')['accepted']:
            for lib in v['libraries']:validate('graphics.schema.json',lib)
        for v in load(FIXTURES/'presentation-package-v1.json')['accepted']:
            validate('presentation-package.schema.json',v['input'])
        with self.assertRaises(jsonschema.ValidationError):
            validate('graph.schema.json',load(FIXTURES/'scene-v5.json'))
        with self.assertRaises(jsonschema.ValidationError):
            validate('presentation.schema.json',load(FIXTURES/'presentation-v2.json'))

    def test_rules_preview_preserves_original_and_round_trips_fields(self):
        value=load(FIXTURES/'rule-set-v5.json');original=copy.deepcopy(value)
        candidate=migrate_rules(value)
        self.assertEqual(value,original);self.assertEqual(candidate['schemaVersion'],6)
        for symbol in candidate['symbols']:
            for c in symbol.get('compartments',[]):self.assertTrue(c['id'])
        candidate['schemaVersion']=5
        for symbol in candidate['symbols']:
            for c in symbol.get('compartments',[]):del c['id']
        self.assertEqual(candidate,original)

    def test_presentation_keys_minima_and_explicit_identity(self):
        source=load(FIXTURES/'presentation-v2.json'); original=copy.deepcopy(source)
        key=next(iter(source['views']));view=source['views'][key]
        identity=dict(packageFingerprint='a'*64,projection='fixture',positions={k:dict(width=50,height=60) for k in view['positions']})
        current=migrate_presentation(source,{key:identity})
        self.assertEqual(source,original)
        for value in current['views'][key]['positions'].values():self.assertGreaterEqual(value['width'],50);self.assertGreaterEqual(value['height'],60)
        for compatibility in [{},{key:dict(identity,positions={})},{key:dict(identity,packageFingerprint='wrong')}]:
            with self.assertRaises(ValueError):migrate_presentation(source,compatibility)

    def test_cli_never_overwrites_original_or_existing_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'rules.json';dest=Path(directory)/'new.json'
            original=(FIXTURES/'rule-set-v5.json').read_bytes();source.write_bytes(original)
            command=[sys.executable,'-B',str(ROOT/'tools/migrate_m12.py'),'rules',str(source)]
            preview=json.loads(subprocess.check_output(command,text=True,encoding='utf-8'))
            self.assertEqual(preview['originalSha256'],hashlib.sha256(original).hexdigest());self.assertEqual(source.read_bytes(),original)
            subprocess.run(command+['--output',str(dest)],check=True,capture_output=True)
            self.assertNotEqual(dest.read_bytes(),original)
            for destination in [source,dest]:
                self.assertNotEqual(subprocess.run(command+['--output',str(destination)],capture_output=True).returncode,0)
            self.assertEqual(source.read_bytes(),original)
if __name__=='__main__':unittest.main()

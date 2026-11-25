"""Generate the M12 structural schemas; runtime validators also check semantics/budgets."""
import json
import os
from pathlib import Path

DEST = Path(os.environ.get('INTERSECT_SCHEMA_OUTPUT', Path(__file__).resolve().parents[1] / 'crates/intersect-views'))
DEST.mkdir(parents=True, exist_ok=True)
def obj(properties, required=None):
    return dict(type='object', properties=properties, required=list(properties) if required is None else required, additionalProperties=False)
def arr(items, limit):
    return dict(type='array', items=items, maxItems=limit)
def ref(name):
    return {'$ref': '#/$defs/' + name}
def tagged(tag, **properties):
    return obj(dict(kind={'const': tag}, **properties))
def either(*items):
    return {'oneOf': list(items)}
def mapping(value, limit=32):
    return dict(type='object', additionalProperties=value, maxProperties=limit)
ID = dict(type='string', minLength=1, maxLength=256)
STRING = dict(type='string')
NUM = dict(type='number', minimum=-1000000, maximum=1000000)
POS = dict(type='number', minimum=0, maximum=1000000)
BOOL = dict(type='boolean')
HASH = dict(type='string', pattern='^[a-f0-9]{64}$')
NULL = dict(type='null')
D = {}
D['value'] = either(BOOL, NUM, STRING)
D['numeric'] = either(NUM, obj({'op': {'enum': ['width', 'height']}}), obj({'op': {'const': 'parameter'}, 'name': ID}), obj({'op': {'enum': ['add', 'subtract', 'multiply', 'divide', 'min', 'max']}, 'left': ref('numeric'), 'right': ref('numeric')}))
D['condition'] = either(BOOL, obj({'op': {'const': 'parameter'}, 'name': ID}), obj({'op': {'const': 'equal'}, 'name': ID, 'value': ref('value')}))
D['numeric']['oneOf'].append(obj({'op':{'enum':['slotWidth','slotHeight']},'slot':ID}))
D['numeric']['oneOf'].append(obj({'op':{'const':'select'},'condition':ref('condition'),'ifTrue':ref('numeric'),'ifFalse':ref('numeric')}))
D['paint'] = either({'type': 'string', 'pattern': '^(none|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$'}, obj({'parameter': ID}))
D['parameter'] = either(tagged('string', default=STRING), tagged('bool', default=BOOL), tagged('number', default=NUM), tagged('choice', values=arr(STRING, 64), default=STRING))
D['source'] = either(obj({'kind': {'enum': ['title', 'subtitle', 'label', 'compartments', 'children', 'regions']}}), tagged('text', name=ID))
D['instance'] = obj({'definition': ID, 'parameters': mapping(ref('value')), 'slots': mapping(ref('source'))})
D['anchor'] = obj(dict(id=ID, **{k: ref('numeric') for k in ['x', 'y', 'dx', 'dy']}))
D['valueExpression'] = either(tagged('constant', value=ref('value')), tagged('parameter', name=ID))
D['point'] = obj({'x': ref('numeric'), 'y': ref('numeric')})
D['pathCommand'] = either(*[tagged(kind, **{k: ref('numeric') for k in keys}) for kind, keys in [('move', ['x', 'y']), ('line', ['x', 'y']), ('quadratic', ['cx', 'cy', 'x', 'y']), ('cubic', ['cx1', 'cy1', 'cx2', 'cy2', 'x', 'y']), ('close', [])]])
extent = dict(width=ref('numeric'), height=ref('numeric'))
D['geometry'] = either(tagged('rectangle', **extent, radius=POS), tagged('ellipse', **extent), tagged('polyline', **extent, points=arr(ref('point'), 2048), closed=BOOL), tagged('path', **extent, commands=arr(ref('pathCommand'), 2048)))
children = arr(ref('part'), 256)
align = {'enum': ['start', 'center', 'end']}
D['content'] = either(
    tagged('frame', padding=POS, radius=POS, fill=ref('paint'), stroke=ref('paint'), strokeWidth=POS, children=children),
    tagged('stack', direction={'enum': ['row', 'column']}, align=align, gap=POS, children=children),
    tagged('overlay', children=children),
    tagged('geometry', geometry=ref('geometry'), fill=ref('paint'), stroke=ref('paint'), strokeWidth=POS),
    tagged('text', slot=ID, size={'type': 'number', 'minimum': 6, 'maximum': 96}, weight={'type': 'integer', 'minimum': 100, 'maximum': 900}, italic=BOOL, align=align, wrap=BOOL, color=ref('paint')),
    tagged('content', slot=ID),
    tagged('use', definition=ID, parameters=mapping(ref('valueExpression')), slots=mapping(ID)),
    tagged('transform', **{k: ref('numeric') for k in ['x', 'y', 'rotate', 'scaleX', 'scaleY']}, child=ref('part')),
)
for content in D['content']['oneOf']:
    if content['properties']['kind']['const'] in ['frame','geometry']:
        content['properties']['dash']={'enum':['solid','dashed','dotted']}
D['size']=obj({key:ref('numeric') for key in ['minimumWidth','preferredWidth','minimumHeight','preferredHeight']})
D['part'] = obj({'id': ID, 'when': either(NULL, ref('condition')), 'anchors': arr(ref('anchor'), 32), 'content': ref('content')})
D['definition'] = obj({'id': ID, 'version': ID, 'role': {'enum': ['node', 'port', 'marker']}, 'parameters': mapping(ref('parameter')), 'slots': mapping({'enum': ['text', 'compartments', 'children', 'regions']}), 'root': ref('part'), 'connectionAnchor': either(NULL, ID)})
D['definition']['properties']['size']=ref('size')
D['library'] = obj({'schemaVersion': {'const': 1}, 'id': ID, 'imports': arr(ID, 64), 'definitions': arr(ref('definition'), 256)})
D['context'] = obj({'fingerprint': HASH, 'libraries': arr(ref('library'), 64)})
D['textPart'] = obj({'id': ID, 'text': {'type': 'string', 'maxLength': 4096, 'pattern': '^[^\\r\\t]*$'}, 'binding': either(NULL, {'$ref': 'graph.schema.json#/$defs/binding'}), 'editTool': NULL})
D['textBlock'] = obj({'runs': arr(obj({'id': ID, 'parts': arr(ref('textPart'), 32)}), 64)})
D['slot'] = either(ID, obj({'text': STRING}), obj({'sourceText': {'const': True}}))
D['labelRule'] = either(ref('slot'), obj({'parts': arr(obj({'id': ID, 'subject': either(tagged('self'), tagged('none'), tagged('select', select=ID)), 'text': ref('slot'), 'when': ID, 'edit': obj({'tool': ID, 'command': ID, 'accepts': ID})}, ['id', 'subject', 'text']), 32)}))
D['rule'] = obj({'definition': ID, 'parameters': mapping(either(tagged('constant', value=ref('value')), tagged('string', value=ref('slot')), tagged('bool', function=ID))), 'slots': mapping(ref('source')), 'text': mapping(obj({'runs': arr(obj({'id': ID, 'label': ref('labelRule')}), 64)}))})
# Symbol properties are an opt-in, typed extension, never arbitrary JSON paths.
D['editor'] = either(tagged('color'), tagged('bool'), tagged('choice'), tagged('number', minimum=NUM, maximum=NUM))
def property_text(limit):
    return dict(type='string', minLength=1, maxLength=limit, pattern='^[^\\u0000-\\u001f\\u007f-\\u009f]*$')
D['symbolProperty'] = obj({'id':ID, 'parameter':ID, 'label':property_text(256), 'group':property_text(128), 'description':property_text(2048), 'editor':ref('editor'), 'editable':BOOL})
D['style'] = obj({key:obj({'parameter':ID}) for key in ['fillEnabled','fill','stroke','strokeWidth','dash','radius','textColor','fontSize','fontWeight','italic','alignment','wrap']}, [])
D['definition']['properties']['properties'] = arr(ref('symbolProperty'),32)
D['definition']['properties']['borderAnchor'] = ID
D['part']['properties']['style'] = ref('style')
D['instance']['properties']['sourceParameters'] = dict(arr(ID,32), uniqueItems=True)

def save(name, value):
    value = {'$schema': 'https://json-schema.org/draft/2020-12/schema', **value}
    (DEST / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8', newline='\n')
save('graphics.schema.json', {'$ref': '#/$defs/library', '$defs': D})
resource = obj({'id': ID, 'kind': {'enum': ['symbolLibrary', 'ruleSet', 'palette', 'notation', 'renderingRegistry']}, 'sha256': HASH})
address = {'type': 'string', 'minLength': 1, 'maxLength': 256, 'pattern': '^[^@]+$'}
manifest = obj({'schemaVersion': {'const': 1}, 'id': address, 'version': address, 'language': ID, 'languageFingerprint': HASH, 'requires': arr({'enum': ['graphics.composition.v1', 'graphics.text.v1', 'graphics.anchors.v1', 'rules.graph.v6', 'rules.graph.v7', 'views.rendering.v1', 'rules.graph.v8', 'views.routing.v1', 'views.labelPlacement.v1', 'views.symbolProperties.v1', 'graphics.borderAnchor.v1']}, 64), 'dependencies': arr(obj({'id': address, 'version': address, 'sha256': HASH}), 64), 'resources': arr(resource, 64)})
manifest['allOf'] = [{'if':{'properties':{'resources':{'contains':{'type':'object','properties':{'kind':{'const':'ruleSet'}},'required':['kind']}}},'required':['resources']},'then':{'properties':{'requires':{'allOf':[{'contains':{'const':cap}} for cap in ['rules.graph.v8','views.routing.v1','views.labelPlacement.v1']]}},'required':['requires']}}]
save('presentation-package.schema.json', obj({'root': ID, 'manifests': arr(manifest, 64), 'resources': arr(obj({'id': ID, 'content': STRING}), 64)}))
select = obj({'select': ID})
region = obj({'id': ID, 'select': ID, 'label': ref('labelRule'), 'children': select, 'direction': {'enum': ['row', 'column']}})
graphic_rule = {'$ref': 'graphics.schema.json#/$defs/rule'}
symbol = obj({'id': ID, 'match': ID, 'emit': {'enum': ['node', 'port']}, 'notation': ID,
    **{k: ref('labelRule') for k in ['title','subtitle','label']}, **{k: ref('slot') for k in ['side','styleClass']},
    'compartments': arr(obj({'id': ID, 'label': STRING, 'rows': ID, 'rowLabel': ref('labelRule')}), 256),
    'ports': obj({'select': ID, 'rule': ID}), 'children': select, 'regions': region,
    'expand': arr(obj({'id': ID, 'label': ID, 'select': ID}), 256), 'create': arr(obj({'tool': ID, 'command': ID, 'accepts': ID}),256), 'graphic': graphic_rule}, ['id','match','emit'])
edge_common = {'id': ID, 'per': ID, 'notation': ID, 'label': ref('labelRule'), 'anchor': {'enum': ['owner','root']}, 'rootOnly': BOOL,
    'connect': obj({'command': ID, 'sourceAccepts': ID, 'targetAccepts': ID}), 'startMarker': graphic_rule, 'endMarker': graphic_rule}
required = ['id','per','notation','label','anchor','kind']
edge = either(obj(dict(edge_common,kind={'const':'element'},select=ID,sourcePath=ID,targetPath=ID), required+['select','sourcePath','targetPath']),
    obj(dict(edge_common,kind={'const':'reference'},targets=ID),required+['targets']))
projection = either(obj({'kind':{'const':'nested'}}), obj({'kind':{'const':'containmentTree'},'edgeRole':ID,'edgeNotation':ID}))
save('graph-rule-set.schema.json',dict(obj({'schemaVersion':{'const':8},'projection':projection,'id':ID,'label':ID,'language':ID,'form':{'const':'graph'},'layout':obj({'strategy':{'const':'layered'},'direction':{'enum':['RIGHT','LEFT','UP','DOWN']}}),'symbols':arr(symbol,256),'edges':arr(edge,256),'routing':{'$ref':'routing.schema.json#/$defs/policy'}}),
    **{'$defs':{'slot':D['slot'],'labelRule':D['labelRule']}}))

if __name__ == '__main__':
    print('Wrote current graphics, presentation-package and graph-rule structural schemas')

"""Authored graphics fixtures, built solely from the public M12 composition vocabulary."""
import copy
import json
from pathlib import Path
DEST = Path(__file__).resolve().parents[1] / 'harness/views/symbols'
def part(name, content, anchors=None):
    return dict(id=name, when=None, anchors=anchors or [], content=content)
def geometry(name, shape, fill='none', stroke='#334b5e'):
    return part(name, dict(kind='geometry', geometry=shape, fill=fill, stroke=stroke, strokeWidth=1.5))
def path(name, commands, width=64, height=40, fill='none'):
    return geometry(name, dict(kind='path', width=width, height=height, commands=[dict(kind=c[0], **dict(zip(c[1::2], c[2::2]))) for c in commands]), fill)
def line(name, points, width=64, height=40):
    return geometry(name, dict(kind='polyline', width=width, height=height, points=[dict(x=x,y=y) for x,y in points], closed=False))
def overlay(name, children):
    return part(name, dict(kind='overlay', children=children))
def at(name, child, x=0, y=0):
    return part(name, dict(kind='transform', x=x, y=y, rotate=0, scaleX=1, scaleY=1, child=child))
def shape(name, children):
    return dict(name=name, root=overlay(name,children))
def rectangle(name,w,h,fill='none',radius=0):
    return geometry(name,dict(kind='rectangle',width=w,height=h,radius=radius),fill)
def ellipse(name,w,h,fill='none'):
    return geometry(name,dict(kind='ellipse',width=w,height=h),fill)

profiles = {
 'sysml': [
  shape('packageTab',[path('tab',[('move','x',0,'y',10),('line','x',0,'y',0),('line','x',28,'y',0),('line','x',34,'y',10),('line','x',64,'y',10),('line','x',64,'y',40),('line','x',0,'y',40),('close',)],fill='#e8e9fa'),line('tabRule',[(0,10),(34,10)])]),
  shape('foldedNote',[path('note',[('move','x',0,'y',0),('line','x',49,'y',0),('line','x',64,'y',15),('line','x',64,'y',40),('line','x',0,'y',40),('close',)],fill='#fff4cc'),line('fold',[(49,0),(49,15),(64,15)])]),
  shape('initial',[ellipse('initialBody',18,18,'#263843')]),
  shape('final',[ellipse('outer',24,24),at('center',ellipse('inner',14,14,'#263843'),5,5)]),
  shape('forkJoin',[rectangle('bar',52,7,'#263843')]),
  shape('hollowTriangle',[path('triangle',[('move','x',0,'y',8),('line','x',16,'y',0),('line','x',16,'y',16),('close',)],width=16,height=16,fill='#ffffff')]),
 ],
 'electrical': [
  shape('resistor',[line('resistive',[(0,20),(10,20),(15,10),(23,30),(31,10),(39,30),(47,10),(52,20),(64,20)])]),
  shape('transformer',[path('coils',[('move','x',0,'y',3),('line','x',16,'y',3),('cubic','cx1',32,'cy1',3,'cx2',32,'cy2',14,'x',16,'y',14),('cubic','cx1',32,'cy1',14,'cx2',32,'cy2',25,'x',16,'y',25),('cubic','cx1',32,'cy1',25,'cx2',32,'cy2',37,'x',16,'y',37),('line','x',0,'y',37),('move','x',64,'y',3),('line','x',48,'y',3),('cubic','cx1',32,'cy1',3,'cx2',32,'cy2',14,'x',48,'y',14),('cubic','cx1',32,'cy1',14,'cx2',32,'cy2',25,'x',48,'y',25),('cubic','cx1',32,'cy1',25,'cx2',32,'cy2',37,'x',48,'y',37),('line','x',64,'y',37)]),line('coreOne',[(31,1),(31,39)]),line('coreTwo',[(35,1),(35,39)])]),
  shape('terminalContactGlyph',[line('lead',[(0,10),(22,10)],width=32,height=20),at('contact',ellipse('terminalContact',12,12,'#ffffff'),22,4)]),
 ],
 'fault': [
  shape('basicEvent',[ellipse('event',38,38,'#fce8e7')]),
  shape('andGate',[path('gate',[('move','x',0,'y',40),('line','x',0,'y',20),('cubic','cx1',0,'cy1',-5,'cx2',40,'cy2',-5,'x',40,'y',20),('line','x',40,'y',40),('close',)],width=40,height=40,fill='#e6f3f1')]),
  shape('orGate',[path('gate',[('move','x',0,'y',40),('quadratic','cx',12,'cy',22,'x',0,'y',0),('quadratic','cx',33,'cy',0,'x',46,'y',20),('quadratic','cx',33,'cy',40,'x',0,'y',40),('close',)],width=46,height=40,fill='#e6f3f1')]),
 ],
}
for name, shapes in profiles.items():
    library = json.loads((DEST/'classic.symbols.json').read_text(encoding='utf-8'))
    namespace = 'example.'+name
    def rename(v):
        if isinstance(v,dict): return {k:rename(x) for k,x in v.items()}
        if isinstance(v,list): return [rename(x) for x in v]
        if isinstance(v,str): return v.replace('harness.symbols',namespace)
        return v
    library=rename(library)
    frame=next(d for d in library['definitions'] if d['id']==namespace+'/card')
    frame['parameters']['fill']['default']={'sysml':'#fff0f5','electrical':'#edf4ff','fault':'#fff5e7'}[name]
    next(d for d in library['definitions'] if d['id']==namespace+'/structured')['parameters']['fill']['default']=frame['parameters']['fill']['default']
    uses=[]
    for s in shapes:
        library['definitions'].append(dict(id=namespace+'/'+s['name'],version='1',role='node',parameters={},slots={},root=s['root'],connectionAnchor=None))
        uses.append(part('show-'+s['name'],dict(kind='use',definition=namespace+'/'+s['name'],parameters={},slots={})))
    if name == 'sysml':
        diamond = copy.deepcopy(next(d for d in library['definitions'] if d['role']=='marker'))
        diamond['id']=namespace+'/hollowDiamondMarker'; diamond['root']['content']['fill']='#ffffff';library['definitions'].append(diamond)
        triangle = copy.deepcopy(diamond);triangle['id']=namespace+'/triangleMarker'
        triangle['root']=path('triangle',[('move','x',0,'y',8),('line','x',16,'y',0),('line','x',16,'y',16),('close',)],width=16,height=16,fill='#ffffff')
        triangle['root']['anchors']=copy.deepcopy(diamond['root']['anchors']);library['definitions'].append(triangle)
    frame['root']['content']['children'].insert(0,part('glyphs',dict(kind='stack',direction='row',align='start',gap=10,children=uses)))
    (DEST/(name+'.symbols.json')).write_text(json.dumps(library,indent=2)+'\n',encoding='utf-8')
library=json.loads((DEST/'classic.symbols.json').read_text(encoding='utf-8'))
for d in library['definitions']:
    if d['role']!='node':continue
    d['slots'].update(children='children',regions='regions')
    if d['root']['content']['kind']=='use':d['root']['content']['slots'].update(children='children',regions='regions')
    else:d['root']['content']['children'].extend([part('children',dict(kind='content',slot='children')),part('regions',dict(kind='content',slot='regions'))])
text=json.dumps(library,indent=2).replace('harness.symbols','example.containers')
(DEST/'containers.symbols.json').write_text(text+'\n',encoding='utf-8')
rules=json.loads((DEST/'symbols.viewrules.json').read_text(encoding='utf-8'))
region_rules=json.loads((DEST.parent/'regions.viewrules.json').read_text(encoding='utf-8'))
rules['symbols'][0]['children']=dict(select='boxParts')
rules['symbols'][0]['regions']=region_rules['symbols'][0]['regions']
rules['symbols'][0]['graphic']['slots'].update(children=dict(kind='children'),regions=dict(kind='regions'))
(DEST/'containers.viewrules.json').write_text(json.dumps(rules,indent=2)+'\n',encoding='utf-8')
print('Wrote independent glyph libraries and nested content-slot fixture')

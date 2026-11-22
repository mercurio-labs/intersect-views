"""Shared native/TS boundary fixtures for M12 graphics (no rendering oracle)."""
import copy
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def part(i,content=None):
 return dict(id=str(i),when=None,anchors=[],content=content or dict(kind='geometry',geometry=dict(kind='rectangle',width=1,height=1,radius=0),fill='#ffffff',stroke='#000000',strokeWidth=1))
def definition(name,root=None):
 return dict(id='limits/'+name,version='1',role='node',parameters={},slots={},root=root or part('body'),connectionAnchor=None)
def library(definitions):
 return [dict(schemaVersion=1,id='limits',imports=[],definitions=definitions)]
def stack(children):return dict(kind='stack',direction='column',align='start',gap=0,children=children)
def use(name,i):return part(i,dict(kind='use',definition='limits/'+name,parameters={},slots={}))
accepted=[];rejected=[]
def case(name,definitions,ok):
 (accepted if ok else rejected).append(dict(name=name,libraries=library(definitions)))
for count in [256,257]:case('definition count '+str(count),[definition(str(i)) for i in range(count)],count==256)
for count in [256,257]:case('authored parts '+str(count),[definition('body',part('root',stack([part(i) for i in range(count-1)])))],count==256)
for depth in [16,17]:
 root=part('leaf')
 for i in range(depth):root=part(i,dict(kind='overlay',children=[root]))
 case('authored depth '+str(depth),[definition('body',root)],depth==16)
for depth in [8,9]:
 defs=[definition(str(depth))]
 for i in range(depth-1,-1,-1):defs.append(definition(str(i),use(str(i+1),'reuse')))
 case('reuse depth '+str(depth),defs,depth==8)
for count in [32,33]:
 d=definition('body');d['parameters']={str(i):dict(kind='bool',default=True) for i in range(count)}
 case('parameter count '+str(count),[d],count==32)
 d=definition('body',part('root',stack([part(i,dict(kind='text',slot=str(i),size=14,weight=400,italic=False,align='start',wrap=True,color='#000000')) for i in range(count)])));d['slots']={str(i):'text' for i in range(count)}
 case('slot count '+str(count),[d],count==32)
for count in [64,65]:
 d=definition('body');d['parameters']={'mode':dict(kind='choice',values=[str(i) for i in range(count)],default='0')};case('choice count '+str(count),[d],count==64)
for count in [2048,2049]:
 d=definition('path');d['root']['content']['geometry']=dict(kind='path',width=1,height=1,commands=[dict(kind='move',x=0,y=0)]+[dict(kind='line',x=1,y=1)]*(count-1));case('path commands '+str(count),[d],count==2048)
for count in [32,33]:
 d=definition('path');d['root']['content']['geometry']=dict(kind='path',width=1,height=1,commands=[dict(kind='move',x=0,y=0)]+[dict(kind='line',x=1,y=1)]*2047)
 case('expanded path commands '+str(count*2048),[d,definition('body',part('root',stack([use('path',i) for i in range(count)])))],count==32)
for tail in [50,51]:
 leaf=definition('leaf',part('root',stack([part(i) for i in range(249)])))
 body=definition('body',part('root',stack([use('leaf','reuse'+str(i)) for i in range(199)]+[part('tail'+str(i)) for i in range(tail)])))
 case('expanded parts '+str(49950+tail),[leaf,body],tail==50)
p=ROOT/'crates/intersect-views/tests/fixtures/graphics-limits-v1.json'
p.write_text(json.dumps(dict(accepted=accepted,rejected=rejected),separators=(',',':'))+'\n',encoding='utf-8')
print('Wrote',len(accepted),'accepted and',len(rejected),'rejected boundary cases')

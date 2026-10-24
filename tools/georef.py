"""Fit static/images/campus.svg onto the real map: python3 tools/georef.py [campus.svg]
Needs osm/*.json next to it: Nominatim results (polygon_geojson=1) for Sather Gate and each building.
Prints the [georef] values for data/map.toml. Scale and offset only (Figma canvas is north-up Mercator)."""
import re,json,math,glob
from xml.dom import minidom
import sys,os,urllib.request,time
SVG=sys.argv[1] if len(sys.argv)>1 else 'static/images/campus.svg'
doc=minidom.parse(SVG)
OSM=lambda n: os.path.join(os.path.dirname(os.path.abspath(__file__)),'osm',n+'.json')
def ctx(el):
    bld=None;g=el.parentNode
    while g and g.nodeType==1:
        if g.tagName=='g':
            i=re.sub(r'_\d+$','',g.getAttribute('id') or '')
            m=re.match(r'^(.*?)\s*\(Floor ([^)]+)\)$',i)
            if m and not bld: bld=m.group(1).strip()
            elif not m and i and not re.match(r'^(Graph|Outdoors?|General|Paths|Links)$',i) and not bld: bld=i
        g=g.parentNode
    return bld
pts=[]
for c in doc.getElementsByTagName('circle'):
    pts.append((c.getAttribute('id'),float(c.getAttribute('cx')),float(c.getAttribute('cy')),c.getAttribute('fill').upper(),ctx(c)))
from collections import Counter
print(Counter((p[4],p[3]) for p in pts))
# mercator
R=6378137
def merc(lon,lat): return (R*math.radians(lon), R*math.log(math.tan(math.pi/4+math.radians(lat)/2)))
def unmerc(x,y): return (math.degrees(x/R), math.degrees(2*math.atan(math.exp(y/R))-math.pi/2))
sg=json.load(open(OSM('Sather_Gate')))[0]; SG=merc(float(sg['lon']),float(sg['lat']))
svg_sg=[p for p in pts if p[0]=='Sather Gate'][0][1:3]
polys={}
names={'Dwinelle Hall':'Dwinelle_Hall','Wheeler Hall':'Wheeler_Hall','VLSB':'Valley_Life_Sciences_Building','MLK Student Union':'Martin_Luther_King_Jr__Student_Union','Alumni House':'Alumni_House'}
for k,f in names.items():
    gj=json.load(open(OSM(f)))[0]['geojson']
    rings=gj['coordinates'] if gj['type']=='Polygon' else [r for p in gj['coordinates'] for r in p]
    polys[k]=[[merc(*c) for c in r] for r in rings]
def dseg(p,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1];q=dx*dx+dy*dy;t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/q)) if q else 0
    return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
def dpoly(p,rings): return min(dseg(p,r[i],r[i+1]) for r in rings for i in range(len(r)-1))
ex=[p for p in pts if p[3] in('#D000FF',) and p[4] in polys]
print(len(ex),'exits with footprints')
def cost(s,tx,ty,rot=0):
    c,si=math.cos(rot),math.sin(rot);tot=0
    for n,x,y,f,b in ex:
        X=tx+s*(c*x-si*y); Y=ty-s*(si*x+c*y)
        tot+=dpoly((X,Y),polys[b])**2
    return tot
# init: scale from bg image: 13825.8 svg px = 1152 img px; guess tile zoom ~17: 1.19 m/px at lat 37.87 -> s ~ 1152/13825.8*1.19
best=None
for s in [0.03+0.0002*i for i in range(250)]:
    tx=SG[0]-s*svg_sg[0]; ty=SG[1]+s*svg_sg[1]
    c=cost(s,tx,ty)
    if not best or c<best[0]: best=(c,s,tx,ty)
print('anchored fit',best, 'rms m',math.sqrt(best[0]/len(ex)))
# free fit (3 params) by coordinate descent
s,tx,ty=best[1:];step=[0.002,20,20]
for it in range(60):
    for k in range(3):
        for d in(-1,1):
            v=[s,tx,ty];v[k]+=d*step[k]
            if cost(*v)<cost(s,tx,ty): s,tx,ty=v
    step=[x*0.8 for x in step]
print('free fit',s,tx,ty,'rms m',math.sqrt(cost(s,tx,ty)/len(ex)))
X=tx+s*svg_sg[0];Y=ty-s*svg_sg[1];print('sather gate shift m',math.hypot(X-SG[0],Y-SG[1]))
for n,x,y,f,b in ex:
    print(f'{dpoly((tx+s*x,ty-s*y),polys[b]):6.1f} {b} {n}')
lon0,lat0=unmerc(tx,ty)
print(f'origin_lon = {lon0}\norigin_lat = {lat0}\nmeters_per_px = {s}')

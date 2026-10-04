# Costruisce le due versioni di Claudia Luce dai file in src/:
#   ../web/claudia-luce.html                      pagina per l'artifact (PC)
#   ../android/app/src/main/assets/www/index.html pagina dell'app Android
# Uso: cd sorgenti && npm install && python3 build.py
import pathlib, shutil, json, subprocess, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
s=pathlib.Path('src')
css=(s/'style.css').read_text()
body=(s/'body.html').read_text()
js=(s/'data.js').read_text()+'\n'+(s/'engine.js').read_text()+'\n'+(s/'parse.js').read_text()+'\n'+(s/'app.js').read_text()
title='<title>Claudia Luce</title>\n'
# --- web (artifact) ---
web=title+'''<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Sans+3:wght@400;600;700&display=swap">
<style>
'''+css+'</style>\n'+body+'\n<script>\n'+js+'\n</script>\n'
pathlib.Path('../web/claudia-luce.html').write_text(web)
pathlib.Path('preview.html').write_text('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>'+web+'</body></html>')
# --- android ---
www=pathlib.Path('../android/app/src/main/assets/www')
(www/'vendor').mkdir(parents=True, exist_ok=True); (www/'fonts').mkdir(parents=True, exist_ok=True)
nm=pathlib.Path('node_modules')
shutil.copy(nm/'pdfjs-dist/build/pdf.min.js', www/'vendor/pdf.min.js')
shutil.copy(nm/'pdfjs-dist/build/pdf.worker.min.js', www/'vendor/pdf.worker.min.js')
shutil.copy(nm/'jspdf/dist/jspdf.umd.min.js', www/'vendor/jspdf.umd.min.js')
fonts={'archivo.woff2':nm/'@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2',
 'source-sans-3-400.woff2':nm/'@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2',
 'source-sans-3-600.woff2':nm/'@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2',
 'source-sans-3-700.woff2':nm/'@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff2',
 'ibm-plex-mono-400.woff2':nm/'@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
 'ibm-plex-mono-500.woff2':nm/'@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2',
 'ibm-plex-mono-600.woff2':nm/'@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2'}
for k,v in fonts.items(): shutil.copy(v, www/'fonts'/k)
ff='''@font-face{font-family:"Archivo";src:url(fonts/archivo.woff2) format("woff2");font-weight:100 900;font-stretch:62% 125%;font-display:swap}
@font-face{font-family:"Source Sans 3";src:url(fonts/source-sans-3-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Source Sans 3";src:url(fonts/source-sans-3-600.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"Source Sans 3";src:url(fonts/source-sans-3-700.woff2) format("woff2");font-weight:700;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url(fonts/ibm-plex-mono-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url(fonts/ibm-plex-mono-500.woff2) format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url(fonts/ibm-plex-mono-600.woff2) format("woff2");font-weight:600;font-display:swap}
html{-webkit-text-size-adjust:100%}body{margin:0}img{max-width:100%}
'''
andr='<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'+title+'<style>\n'+ff+css+'</style>\n</head>\n<body>\n'+body+'\n<script>\n'+js+'\n</script>\n</body>\n</html>\n'
(www/'index.html').write_text(andr)
print('web',len(web),'android',len(andr))

import pathlib,glob
root=pathlib.Path(__file__).parent
t=(root/'template.html').read_text()
app='\n'.join(pathlib.Path(f).read_text() for f in sorted(glob.glob(str(root/'src/*.js'))))
three=(root/'vendor/package/build/three.min.js').read_text()
out=t.replace('<script>/*THREE*/</script>','<script>'+three+'</script>').replace('/*APP*/',app)
(root/'dist').mkdir(exist_ok=True); (root/'dist/index.html').write_text(out); print(len(out))

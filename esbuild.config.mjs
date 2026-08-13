import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';

const banner = `/* my-agenda — built from src/main.ts, do not edit main.js by hand */`;

const mode = process.argv[2]; // 'watch' | 'production' | undefined
const watch = mode === 'watch';
const prod = mode === 'production';

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron', ...builtins],
	format: 'cjs',
	target: 'es2018',
	logLevel: 'info',
	sourcemap: watch ? 'inline' : false,
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
});

if (watch) {
	await context.watch();
} else {
	await context.rebuild();
	await context.dispose();
	process.exit(0);
}

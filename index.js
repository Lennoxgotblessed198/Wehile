// This was made by Lennoxgotblessed
// to clone websites but not to pirate them
// If you want to use this code, please give credit to the author
// and dont do illegal stuff with it
// https://github.com/Lennoxgotblessed198/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { load } from 'cheerio';
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.join(__dirname, 'websites');

const banner = `
${chalk.blue.bold('   __        __   _     _ _         ')}
${chalk.blue.bold('   \\ \\      / /__| |__ (_) | ___   ')}${chalk.cyan.bold('Website Cloner CLI')}
${chalk.blue.bold("    \\ \\/\\ \\/ / _ \\ '_ \\| | |/ _ \\")}  ${chalk.yellow('Clone static sites (HTML/CSS/JS)')}
${chalk.blue.bold('     \\ V  V /  __/ | | | | |  __/  ')}
${chalk.blue.bold('      \\_/\\_/ \\___|_| |_|_|_|\\___|  ')}v1.0.0
`;

function sanitizePath(p) {
  return p.replace(/[^a-zA-Z0-9._\-/]/g, '-');
}

function ensureExt(p, isHTML) {
  const ext = path.extname(p);
  if (isHTML) return ext ? p : p + '.html';
  return ext ? p : p + '.asset';
}

function toLocalPath(outDir, root, rawUrl, isHTML) {
  const u = new URL(rawUrl);
  let p = u.pathname;
  if (!p || p.endsWith('/')) p = path.posix.join(p, 'index');
  p = ensureExt(p, isHTML);
  p = sanitizePath(p);
  return path.join(outDir, u.host, p);
}

function normalizeURL(baseUrl, href) {
  href = (href || '').trim();
  if (!href) return '';
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return '';
  try {
    const bu = new URL(baseUrl);
    const uu = new URL(href, bu);
    uu.hash = '';
    return uu.toString();
  } catch {
    return '';
  }
}

async function fetch(client, u, userAgent) {
  return client.get(u, { responseType: 'arraybuffer', headers: userAgent ? { 'User-Agent': userAgent } : undefined });
}

async function saveFile(target, data) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, data);
}

async function handleHTML({ pageUrl, body, opts, mode, enqueue }) {
  const $ = load(body);
  const pageLocal = toLocalPath(opts.outDir, opts.startURL, pageUrl, true);
  const relTo = (targetUrl, isHTML) => {
    const localTarget = toLocalPath(opts.outDir, opts.startURL, targetUrl, isHTML);
    let rel = path.relative(path.dirname(pageLocal), localTarget);
    return rel.split(path.sep).join('/');
  };

  $('base[href]').remove();

  if (mode !== 'ASSETS_ONLY') {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const nu = normalizeURL(pageUrl, href);
      if (!nu) return;
      if (shouldVisit(nu, opts)) {
        enqueue(nu);
        $(el).attr('href', relTo(nu, true));
      }
    });
  }

  if (mode !== 'HTML_ONLY') {
    $("link[rel='stylesheet']").each((_, el) => {
      const href = $(el).attr('href');
      const nu = normalizeURL(pageUrl, href);
      if (!nu) return;
      if (shouldVisit(nu, opts)) {
        enqueue(nu);
        $(el).attr('href', relTo(nu, false));
      }
    });
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      const nu = normalizeURL(pageUrl, src);
      if (!nu) return;
      if (shouldVisit(nu, opts)) {
        enqueue(nu);
        $(el).attr('src', relTo(nu, false));
      }
    });
    $("link[rel='icon'], link[rel='shortcut icon']").each((_, el) => {
      const href = $(el).attr('href');
      const nu = normalizeURL(pageUrl, href);
      if (!nu) return;
      if (shouldVisit(nu, opts)) {
        enqueue(nu);
        $(el).attr('href', relTo(nu, false));
      }
    });
  }

  $('meta[http-equiv="refresh"]').each((_, el) => {
    const content = $(el).attr('content') || '';
    const m = content.match(/url\s*=\s*([^;]+)$/i);
    if (!m) return;
    const nu = normalizeURL(pageUrl, m[1]);
    if (!nu) return;
    if (shouldVisit(nu, opts)) {
      enqueue(nu);
      const rel = relTo(nu, true);
      $(el).attr('content', content.replace(/url\s*=\s*([^;]+)$/i, 'url=' + rel));
    }
  });

  await saveFile(pageLocal, $.html());
}

function sameHost(a, b) {
  try { return new URL(a).host === new URL(b).host; } catch { return false; }
}

function shouldVisit(nu, opts) {
  if (!nu) return false;
  if (opts.respectDomain && !sameHost(nu, opts.startURL)) return false;
  return true;
}

async function run(opts) {
  const mode = process.env.CLONE_MODE || 'FULL';
  const spinner = ora({ text: chalk.cyan('Starting...'), color: 'cyan' }).start();
  const client = axios.create({ timeout: 20000, maxRedirects: 5, validateStatus: s => s < 400 });

  if (!/^https?:\/\//i.test(opts.startURL)) opts.startURL = 'https://' + opts.startURL;
  await fs.promises.mkdir(opts.outDir, { recursive: true });

  const visited = new Set();
  const queue = [opts.startURL];

  while (queue.length && visited.size < opts.maxPages) {
    const u = queue.shift();
    if (visited.has(u)) continue;
    visited.add(u);

    spinner.text = chalk.blue('Fetching: ') + u;
    try {
      const res = await fetch(client, u, opts.userAgent);
      const ct = String(res.headers['content-type'] || '');
      if (ct.includes('text/html')) {
        await handleHTML({ pageUrl: u, body: res.data.toString('utf-8'), opts, mode, enqueue: (nu) => { if (!visited.has(nu) && queue.length < opts.maxPages) queue.push(nu); } });
      } else if (ct.includes('text/css') || ct.includes('application/javascript') || ct.includes('text/javascript')) {
        const local = toLocalPath(opts.outDir, opts.startURL, u, false);
        await saveFile(local, res.data);
      }
    } catch {}
  }

  spinner.succeed(chalk.green('Done.'));
}

async function main() {
  console.log(banner);

  const program = new Command();
  program
    .option('--url <url>', 'Start URL to clone')
    .option('--max <n>', 'Maximum pages', v => parseInt(v, 10), 200)
    .option('--samedomain', 'Restrict to same domain')
    .option('--no-samedomain', 'Allow cross-domain')
    .option('--ua <str>', 'Custom User-Agent')
    .option('--no-interactive', 'Disable interactive prompts')
    .parse(process.argv);

  const po = program.opts();
  let opts = {
    startURL: po.url || '',
    outDir: OUT_DIR,
    maxPages: po.max,
    respectDomain: po.samedomain !== false,
    userAgent: po.ua || '',
    interactive: po.interactive !== false,
  };

  if (!opts.startURL && opts.interactive) {
    const answers = await inquirer.prompt([
      { type: 'input', name: 'startURL', message: 'Enter start URL:' },
      { type: 'number', name: 'maxPages', message: 'Max pages:', default: 200 },
      { type: 'confirm', name: 'respectDomain', message: 'Restrict to same domain?', default: true },
      { type: 'input', name: 'userAgent', message: 'Custom User-Agent (optional):', default: '' },
      { type: 'list', name: 'mode', message: 'Select action:', choices: [
        { name: 'Quick clone (HTML/CSS/JS)', value: 'FULL' },
        { name: 'HTML only', value: 'HTML_ONLY' },
        { name: 'Assets only (CSS/JS)', value: 'ASSETS_ONLY' },
      ], default: 'FULL' },
    ]);
    opts = { ...opts, ...answers };
    process.env.CLONE_MODE = answers.mode;
  }

  if (!opts.startURL) {
    console.error(chalk.red('No URL provided. Use --url or run interactively.'));
    process.exit(1);
  }

  await run(opts);
}

main().catch(err => {
  console.error(chalk.red('Error: ' + err.message));
  process.exit(1);
});

import { regionalDiff, removeLocTags } from '../regional-diff/regional-diff.js';
import { daFetch, saveToDa } from '../../../utils/daFetch.js';
import { releaseDnt } from '../dnt/dnt.js';

const DA_ORIGIN = 'https://admin.da.live';
const DEFAULT_TIMEOUT = 20000; // ms

const PARSER = new DOMParser();

let projPath;
let projJson;

async function fetchData(path) {
  const resp = await daFetch(path);
  if (!resp.ok) return null;
  return resp.json();
}

export function formatDate(timestamp) {
  const rawDate = timestamp ? new Date(timestamp) : new Date();
  const date = rawDate.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  const time = rawDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return { date, time };
}

export function calculateTime(startTime) {
  const crawlTime = Date.now() - startTime;
  return `${String(crawlTime / 1000).substring(0, 4)}s`;
}

export async function detectService(config, env = 'stage') {
  const name = config['translation.service.name']?.value;
  if (name === 'GLaaS') {
    return {
      name: 'GLaaS',
      canResave: true,
      origin: config[`translation.service.${env}.origin`].value,
      clientid: config[`translation.service.${env}.clientid`].value,
      actions: await import('../glaas/index.js'),
      preview: config[`translation.service.${env}.preview`].value,
    };
  }
  return {
    name: 'Google',
    origin: 'https://translate.da/live',
    canResave: false,
    actions: await import('../google/index.js'),
  };
}

export async function getDetails() {
  projPath = window.location.hash.replace('#', '');
  const data = await fetchData(`${DA_ORIGIN}/source${projPath}.json`);
  return data;
}

export function convertUrl({ path, srcLang, destLang }) {
  const source = path.startsWith(srcLang) ? path : `${srcLang}${path}`;
  const destSlash = srcLang === '/' ? '/' : '';
  const destination = path.startsWith(srcLang) ? path.replace(srcLang, `${destLang}${destSlash}`) : `${destLang}${path}`;

  return { source, destination };
}

export async function saveStatus(json) {
  // Make a deep (string) copy so the in-memory data is not destroyed
  const copy = JSON.stringify(json);

  // Only save if the data is different;
  if (copy === projJson) return json;

  // Store it for future comparisons
  projJson = copy;

  // Re-parse for other uses
  const proj = JSON.parse(projJson);

  // Do not persist source content
  proj.urls.forEach((url) => { delete url.content; });

  const body = new FormData();
  const file = new Blob([JSON.stringify(proj)], { type: 'application/json' });
  body.append('data', file);
  const opts = { body, method: 'POST' };
  const resp = await daFetch(`${DA_ORIGIN}/source${projPath}.json`, opts);
  if (!resp.ok) return { error: 'Could not update project' };
  return json;
}

async function saveVersion(path, label) {
  const opts = { method: 'POST' };
  if (label) opts.body = JSON.stringify({ label });

  const res = await daFetch(`${DA_ORIGIN}/versionsource${path}`, opts);
  return res;
}

export async function overwriteCopy(url, title) {
  const body = new FormData();
  body.append('destination', url.destination);
  const opts = { method: 'POST', body };
  const daResp = await daFetch(`${DA_ORIGIN}/copy${url.source}`, opts);
  url.status = 'success';
  // Don't wait the version save
  saveVersion(url.destination, `${title} - Rolled Out`);
  return daResp;
}

const collapseWhitespace = (str) => str.replace(/\s+/g, ' ');

const getHtml = async (url, format = 'dom') => {
  const res = await daFetch(`${DA_ORIGIN}/source${url}`);
  if (!res.ok) return null;
  const str = await res.text();
  if (format === 'text') return str;
  return PARSER.parseFromString(collapseWhitespace(str), 'text/html');
};

const getDaUrl = (url) => {
  const [, org, repo, ...path] = url.destination.split('/');
  const pathname = `/${path.join('/').replace('.html', '')}`;
  return { org, repo, pathname };
};

export async function rolloutCopy(url, projectTitle) {
  // if the regional folder has content that differs from langstore,
  // then a regional diff needs to be done
  try {
    const regionalCopy = await getHtml(url.destination);
    if (!regionalCopy) {
      throw new Error('No regional content or error fetching');
    }

    const langstoreCopy = await getHtml(url.source);
    if (!langstoreCopy) {
      throw new Error('No langstore content or error fetching');
    }

    removeLocTags(regionalCopy);

    if (langstoreCopy.querySelector('main').outerHTML === regionalCopy.querySelector('main').outerHTML) {
      // No differences, don't need to do anything
      url.status = 'success';
      return Promise.resolve();
    }

    // There are differences, upload the annotated loc file
    const diffedMain = await regionalDiff(langstoreCopy, regionalCopy);

    return new Promise((resolve) => {
      const daUrl = getDaUrl(url);
      const savePromise = saveToDa(diffedMain.innerHTML, daUrl);

      const timedout = setTimeout(() => {
        url.status = 'timeout';
        resolve('timeout');
      }, DEFAULT_TIMEOUT);

      savePromise.then(({ daResp }) => {
        clearTimeout(timedout);
        url.status = daResp.ok ? 'success' : 'error';
        if (daResp.ok) {
          saveVersion(url.destination, `${projectTitle} - Rolled Out`);
        }
        resolve();
      }).catch(() => {
        clearTimeout(timedout);
        url.status = 'error';
        resolve();
      });
    });
  } catch (e) {
    return overwriteCopy(url, projectTitle);
  }
}

export async function mergeCopy(url, projectTitle) {
  try {
    const regionalCopy = await getHtml(url.destination);
    if (!regionalCopy) throw new Error('No regional content or error fetching');

    const langstoreCopy = await getHtml(url.source);
    if (!langstoreCopy) throw new Error('No langstore content or error fetching');

    removeLocTags(regionalCopy);

    if (langstoreCopy.querySelector('main').outerHTML === regionalCopy.querySelector('main').outerHTML) {
      // No differences, don't need to do anything
      url.status = 'success';
      return { ok: true };
    }

    // There are differences, upload the annotated loc file
    const diffedMain = await regionalDiff(langstoreCopy, regionalCopy);

    const daUrl = getDaUrl(url);
    const { daResp } = await saveToDa(diffedMain.innerHTML, daUrl);
    if (daResp.ok) {
      url.status = 'success';
      saveVersion(url.destination, `${projectTitle} - Rolled Out`);
    }
    return daResp;
  } catch (e) {
    return overwriteCopy(url, projectTitle);
  }
}

export async function saveLangItems(sitePath, items, lang) {
  return Promise.all(items.map(async (item) => {
    const html = await item.blob.text();
    const dom = PARSER.parseFromString(html, 'text/html');
    const dntedHtml = releaseDnt(dom);

    const blob = new Blob([dntedHtml], { type: 'text/html' });

    const path = `${sitePath}${lang.location}${item.basePath}`;
    const body = new FormData();
    body.append('data', blob);
    const opts = { body, method: 'POST' };
    try {
      const resp = await daFetch(`${DA_ORIGIN}/source${path}`, opts);
      return { success: resp.status };
    } catch {
      return { error: 'Could not save documents' };
    }
  }));
}

/**
 * Run a function with a maximum timeout.
 * If the timeout limit hits, resolve the still in progress promise.
 *
 * @param {Function} fn the function to run
 * @param {Number} timeout the miliseconds to wait before timing out.
 * @returns the results of the function
 */
export async function timeoutWrapper(fn, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const loading = fn();

    const timedout = setTimeout(() => {
      resolve({ error: 'timeout', loading });
    }, timeout);

    loading.then((result) => {
      clearTimeout(timedout);
      resolve(result);
    }).catch((error) => {
      clearTimeout(timedout);
      resolve({ error });
    });
  });
}

import { LitElement, html, nothing } from '../../../../deps/lit/dist/index.js';
import { getConfig } from '../../../../scripts/nexter.js';
import getSvg from '../../../../utils/svg.js';
import getStyle from '../../../../utils/styles.js';
import { formatDate, saveStatus, timeoutWrapper, overwriteCopy, mergeCopy } from '../index.js';
import { Queue } from '../../../../public/utils/tree.js';

const { nxBase } = getConfig();
const style = await getStyle(import.meta.url);
const shared = await getStyle(`${nxBase}/blocks/loc/project/views/shared.js`);
const buttons = await getStyle(`${nxBase}/styles/buttons.js`);

const ICONS = [
  `${nxBase}/blocks/loc/img/Smock_ChevronRight_18_N.svg`,
];

class NxLocEnglishCopy extends LitElement {
  static properties = {
    state: { attribute: false },
    conflictBehavior: { attribute: false },
    details: { attribute: false },
    langs: { attribute: false },
    urls: { attribute: false },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style, shared, buttons];
    getSvg({ parent: this.shadowRoot, paths: ICONS });
    setTimeout(() => { this.toggleExpand(); }, 100);
  }

  toggleExpand() {
    this.shadowRoot.querySelector('.da-loc-panel-expand-btn').classList.toggle('rotate');
    this.shadowRoot.querySelector('.da-loc-panel-content').classList.toggle('is-visible');
  }

  requestPanelUpdates() {
    this.dispatchEvent(new CustomEvent('status', {
      detail: true,
      bubbles: true,
      composed: true,
    }));
  }

  async handleEnglishCopy(lang) {
    // Don't english-copy if in progress
    if (lang.englishcopy.status === 'copying') return;

    lang.englishcopy.status = 'copying';
    lang.englishcopy.copied = 0;
    lang.englishcopyDate = undefined;
    lang.errors = [];
    const items = this.urls.map((url) => {
      const source = `${this.sitePath}${this.sourceLang.location}${url.basePath}`;
      const destination = `${this.sitePath}${lang.location}${url.basePath}`;
      return async () => {
        let resp;
        if (this.conflictBehavior === 'overwrite') {
          resp = await overwriteCopy({ source, destination }, this.title);
        } else {
          resp = await mergeCopy({ source, destination }, this.title);
        }
        if (resp.ok || resp.error === 'timeout') {
          lang.englishcopy.copied += 1;
        } else {
          console.log('there was an error');
          lang.errors.push({ source, destination });
        }
      };
    });

    const queue = new Queue(timeoutWrapper, 50);
    await Promise.all(items.map((item) => queue.push(item)));
    if (lang.englishcopy.copied === this.urls.length) {
      lang.englishcopy.status = 'complete';
      lang.englishcopyDate = Date.now();
      lang.rollout = {
        status: 'ready',
        ready: lang.englishcopy.copied,
      };
    } else {
      lang.englishcopy.status = 'error';
    }

    await saveStatus(this.state);
    this.requestPanelUpdates();
    this.requestUpdate();
  }

  async handleEnglishCopyAll() {
    await Promise.all(this.langs.map((lang) => this.handleEnglishCopy(lang)));
  }

  getLangStatus(lang) {
    if (lang.englishcopy.status) return lang.englishcopy.status;
    return lang.action === 'english-copy' ? 'ready' : 'not ready';
  }

  canEnglishCopy(lang) {
    return ['not started', 'complete'].includes(lang.englishcopy.status);
  }

  get _englishCopy() {
    const total = this.urls.length;
    return total.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ',');
  }

  get _canEnglishCopyAll() {
    return this.langs.every((lang) => ['not started', 'complete'].includes(lang.englishcopy.status));
  }

  renderEnglishCopyDate(lang) {
    if (!lang.englishcopyDate) return nothing;
    const { date, time } = formatDate(lang.englishcopyDate);
    return html`<p class="da-card-date">${date} at ${time}</p>`;
  }

  render() {
    return html`
      <div class="da-loc-panel">
        <div class="da-loc-panel-title">
          <h3>English Copy <span class="quiet">(${this._englishCopy} items)</span></h3>
          <div class="da-loc-panel-title-expand">
            <h3>Behavior: <span class="quiet">${this.conflictBehavior}</span></h3>
            <button class="da-loc-panel-expand-btn" @click=${this.toggleExpand} aria-label="Toggle Expand"><svg class="icon"><use href="#spectrum-chevronRight"/></svg></button>
          </div>
        </div>
        <div class="da-loc-panel-content">
          <div class="da-lang-cards">
            ${this.langs.map((lang) => html`
              <div class="da-lang-card">
                <div class="da-card-header ${this.getLangStatus(lang).replace(' ', '-')}">
                  <div>
                    <p class="da-card-subtitle">Language</p>
                    <p class="da-card-title">${lang.name}</p>
                  </div>
                  <p class="da-card-badge">${this.getLangStatus(lang)}</p>
                </div>
                <div class="da-card-content">
                  <div class="da-card-details">
                    <div>
                      <p class="da-card-subtitle">Copied</p>
                      <p class="da-card-title">${lang.englishcopy.copied || 0} of ${this.urls.length}</p>
                    </div>
                  </div>
                </div>
                <div class="da-card-actions">
                  <div>${this.renderEnglishCopyDate(lang)}</div>
                  <button class="primary" @click=${() => this.handleEnglishCopy(lang)} ?disabled=${!this.canEnglishCopy(lang)}>English Copy</button>
                </div>
              </div>
            `)}
          </div>
        </div>
        <div class="da-loc-panel-actions">
          <p></p>
          <button class="primary" @click=${this.handleEnglishCopyAll} ?disabled=${!this._canEnglishCopyAll}>English Copy all</button>
        </div>
      </div>
    `;
  }
}

customElements.define('nx-loc-english-copy', NxLocEnglishCopy);

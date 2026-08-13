import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { EmbedPoster } from './components/EmbedPoster.tsx';
import './index.css';

// Inside an iframe the game does not boot: an embedding article gets a poster
// that breaks out to the standalone page (see EmbedPoster). A hold-to-drive
// game needs the whole viewport - pedals, corner map and camera - which a
// content-column frame cannot give it, and a run started in a frame would
// fight the article's own scrolling. Comparing window references is allowed
// across origins; the try/catch is for sandboxes that block even that.
function isEmbedded(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

const embedded = isEmbedded();
// Marks the document so the poster page can be locked to the frame: see
// `.is-embed` in index.css. Set before the first render so there is never a
// frame where the host shows a scrollbar.
if (embedded) document.documentElement.classList.add('is-embed');

createRoot(document.getElementById('root')!).render(<StrictMode>{embedded ? <EmbedPoster /> : <App />}</StrictMode>);

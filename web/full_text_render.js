/* global PDFViewerApplication */

import { RenderingStates } from './pdf_rendering_queue';

const INTERVAL_RESUME_RENDER = 250;
const MAX_CACHE_SIZE = 100;
const MAX_AVG_WORD_LENGTH = 10;

// The view currently being rendered.
let renderingView = null;

// The interval timer used to check that the view being rendered isn't paused by the renderer.
let timer = null;

function forEachView(callback) {
  // Iterating from the last page on up since the user will, in most cases, be
  // positioned on the first page.
  const pages = PDFViewerApplication.pdfViewer._pages;
  for (let n = pages.length - 1; n >= 0; --n) {
    try {
      const result = callback(pages[n]);
      if (result !== undefined) {
        return result;
      }
    } catch (x) {
      console.error('Exception occurred while iterating over all views:', x);
    }
  }

  return undefined;
}

function getAllRenderPromises() {
  const promises = [];
  forEachView((view) => {
    const { renderingState, paintTask, } = view;
    if (renderingState !== RenderingStates.PAUSED && paintTask) {
      promises.push(paintTask.promise);
    }
  });

  return promises;
}

function renderNextPage() {
  forEachView((view) => {
    // A PDF view is considered to have been rendered when its text layer
    // exists in the DOM and contains at least one element.  Note that on blank
    // pages (not containing any text) an element is still rendered with the
    // following form:
    //
    //   <div class="endOfContent active"></div>
    if (!view.textLayer || view.textLayer.textLayerDiv.childNodes.length < 1) {
      renderingView = view;
      view.renderingQueue.renderView(view);
      return true;
    }
  });
}

function updateInitialLoadingProgress(progress) {
  let dlgbox, meter;
  try {
    dlgbox = document.getElementById('loading-dlgbox');
    meter = dlgbox.querySelector('progress');
  } catch (x) {
    return;
  }

  if (progress >= 100) {
    dlgbox.removeAttribute('visible');
    return;
  }

  meter.value = Math.round(progress);
  dlgbox.setAttribute('visible', '');
}

function startTimer() {
  stopTimer();
  timer = setInterval(onResumeRender, INTERVAL_RESUME_RENDER);
}

function stopTimer() {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

function calculateAverageWordLength(totalPages) {
  // Make sure that the document supports highlights by calculating its
  // average word length.
  let len = 0, words = 0;
  for (let p = 1; p <= totalPages; ++p) {
    const container = document.querySelector(
      `#viewer .page[data-page-number="${p}"]`);
    if (container == null) {
      console.error('failed to locate page container for:', p);
      continue;
    }

    const text = container.textContent;
    len += text.length;
    const pwords = text.split(/\s+/).length;
    words += pwords;
    len -= pwords; // subtract 1 space per word from total length
  }

  const avg = len / words;
  console.log('average word length: %s [len=%d][words=%d]',
              avg.toFixed(2), len, words);
  return avg;
}

function onResumeRender() {
  // The rendering engine may, in some circumstances, decide to pause rendering
  // a page it had been instructed to render.  Since we want all the views to
  // render in the order we specify, we make sure that the view currently being
  // rendered doesn't enter the paused state.  When it does, we forcefully
  // resume its rendering.  This check is meant to be carried out in an
  // interval-type timer.
  if (renderingView != null &&
      renderingView.renderingState === RenderingStates.PAUSED) {
    renderingView.renderingQueue.renderView(renderingView);
  }
}

function onDocumentLoaded() {
  const app = PDFViewerApplication;
  const pdfViewer = app.pdfViewer;
  if (!pdfViewer.keepTextLayers) {
    return;
  } else if (pdfViewer.pagesCount > MAX_CACHE_SIZE) {
    alert(`\
It is not possible to enable highlights in this document because it is too \
large.

Contact support for additional information.`);
    return;
  }

  const rendered = {};
  const onRendered = function(ev) {
    stopTimer();

    const num = ev.pageNumber - 1;
    if (rendered[num] === true) {
      console.warn(`page already rendered: ${num}`);
    } else {
      rendered[num] = true;
    }

    const count = app.pagesCount;
    const done = Object.keys(rendered).length;
    console.log(`page rendered: ${num} (${done}/${count})`);
    updateInitialLoadingProgress(done / count * 100);

    // Wait until all rendering has concluded to prevent strange failures from
    // occurring; keep rendering until all pages done.
    if (getAllRenderPromises().length > 0) {
      return;
    } else if (done < count) {
      startTimer();
      renderNextPage();
      return;
    }

    const wordLen = calculateAverageWordLength(count);
    const enableHighlights = wordLen > 1 && wordLen < MAX_AVG_WORD_LENGTH;
    if (!enableHighlights) {
      alert(`\
Unfortunately, the format used to produce this document is unsupported and \
consequently highlights will not be available.

Contact support for additional information.`);
    }

    // All pages rendered.  Clean up state and fire custom event to let
    // application know document is ready for use.
    console.info('all pages rendered.');
    app.eventBus.off('textlayerrendered', onRendered);

    const event = new CustomEvent('documentrendered', { detail: { enableHighlights, }, });
    document.dispatchEvent(event);
  };

  // Show loading dialog box and start listening to text layer events.
  updateInitialLoadingProgress(0);
  app.eventBus.on('textlayerrendered', onRendered);
}

function init(app) {
  app.eventBus.on('documentload', onDocumentLoaded);
}

export { init, };
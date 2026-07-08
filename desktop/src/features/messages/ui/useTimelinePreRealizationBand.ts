import * as React from "react";

const PRE_REALIZATION_BAND_PX = 1800;
const ROW_SELECTOR = ".timeline-row-cv";
const PRE_REALIZED_ATTR = "data-buzz-pre-realized";

/**
 * Keeps a band of timeline rows above the viewport fully realized before a
 * momentum up-scroll reaches them.
 *
 * `content-visibility: auto` is the right steady-state tradeoff for long
 * channels, but a never-painted row uses its estimated `contain-intrinsic-size`
 * until the frame it becomes relevant. On WebKit that realization can happen
 * under the reading row during trackpad momentum, producing a visible lurch
 * before the anchoring writer can compensate. This hook warms rows while they
 * are still comfortably above the viewport, then releases them back to CSS once
 * they leave the band; after a row has painted once, `contain-intrinsic-size:
 * auto <fallback>` can reuse the remembered real size instead of the fallback.
 */
export function useTimelinePreRealizationBand({
  contentRef,
  scrollContainerRef,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  React.useEffect(() => {
    const content = contentRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (
      !content ||
      !scrollContainer ||
      typeof IntersectionObserver === "undefined" ||
      typeof MutationObserver === "undefined"
    ) {
      return;
    }

    const observedRows = new Set<HTMLElement>();
    const preRealizedRows = new Set<HTMLElement>();
    let observeFrame: number | null = null;

    const releaseRow = (row: HTMLElement) => {
      if (!preRealizedRows.delete(row)) {
        return;
      }
      row.style.removeProperty("content-visibility");
      row.removeAttribute(PRE_REALIZED_ATTR);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const row = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            row.style.setProperty("content-visibility", "visible");
            row.setAttribute(PRE_REALIZED_ATTR, "true");
            preRealizedRows.add(row);
          } else {
            releaseRow(row);
          }
        }
      },
      {
        root: scrollContainer,
        // Expand only above the viewport: rows below/inside the reader can stay
        // under normal `content-visibility:auto`, while rows the user is about
        // to reach during up-scroll are warmed. The negative bottom margin
        // pulls the IO root's bottom edge up to the viewport top, so the band is
        // [viewportTop - PRE_REALIZATION_BAND_PX, viewportTop].
        rootMargin: `${PRE_REALIZATION_BAND_PX}px 0px -100% 0px`,
        threshold: 0,
      },
    );

    const observeRows = () => {
      observeFrame = null;
      for (const row of content.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
        if (observedRows.has(row)) {
          continue;
        }
        observedRows.add(row);
        observer.observe(row);
      }
    };

    const forgetRemovedRows = (nodes: NodeList) => {
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        const rows = node.matches(ROW_SELECTOR)
          ? [node]
          : Array.from(node.querySelectorAll<HTMLElement>(ROW_SELECTOR));
        for (const row of rows) {
          if (!observedRows.delete(row)) {
            continue;
          }
          observer.unobserve(row);
          releaseRow(row);
        }
      }
    };

    const scheduleObserveRows = () => {
      if (observeFrame !== null) {
        return;
      }
      observeFrame = requestAnimationFrame(observeRows);
    };

    observeRows();

    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        forgetRemovedRows(mutation.removedNodes);
      }
      scheduleObserveRows();
    });
    mutationObserver.observe(content, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
      if (observeFrame !== null) {
        cancelAnimationFrame(observeFrame);
      }
      for (const row of preRealizedRows) {
        row.style.removeProperty("content-visibility");
        row.removeAttribute(PRE_REALIZED_ATTR);
      }
      preRealizedRows.clear();
      observedRows.clear();
    };
  }, [contentRef, scrollContainerRef]);
}

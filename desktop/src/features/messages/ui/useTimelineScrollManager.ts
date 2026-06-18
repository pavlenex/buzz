import * as React from "react";

import {
  isNearBottom,
  resolveDeepLinkTarget,
  selectLatestMessageAutoScrollBehavior,
  selectLatestMessageKey,
} from "@/features/messages/lib/timelineSnapshot";
import type { TimelineMessage } from "@/features/messages/types";
import type { ListVirtualizer } from "@/shared/ui/VirtualizedList";
import { useConvergentScrollToMessage } from "./useConvergentScrollToMessage";

type UseTimelineScrollManagerOptions = {
  channelId?: string | null;
  isFetchingOlder?: boolean;
  isLoading: boolean;
  messages: TimelineMessage[];
  onTargetReached?: (messageId: string) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  targetMessageId?: string | null;
  /**
   * When the timeline is virtualized, the caller supplies a getter for the
   * virtualizer and a live message-id -> item-index map. Scroll-to-message and
   * scroll-to-bottom then drive the virtualizer's index model (off-screen rows
   * have no DOM node to `querySelector`). When omitted (e.g. the thread panel,
   * which is not virtualized), the hook falls back to its DOM-imperative paths.
   */
  virtualizer?: {
    getVirtualizer: () => ListVirtualizer | null;
    indexByMessageId: Map<string, number>;
    itemCount: number;
  } | null;
};

type PinToBottomOptions = {
  clearNewMessageCount?: boolean;
};

export function useTimelineScrollManager({
  channelId,
  isFetchingOlder = false,
  isLoading,
  messages,
  onTargetReached,
  scrollContainerRef,
  targetMessageId,
  virtualizer = null,
}: UseTimelineScrollManagerOptions) {
  const timelineRef = scrollContainerRef;
  const contentRef = React.useRef<HTMLDivElement>(null);
  const bottomAnchorRef = React.useRef<HTMLDivElement>(null);
  const hasInitializedRef = React.useRef(false);
  const shouldStickToBottomRef = React.useRef(true);
  const isAtBottomRef = React.useRef(true);
  const isProgrammaticBottomScrollRef = React.useRef(false);
  const previousTimelineHeightRef = React.useRef<number | null>(null);
  const previousScrollTopRef = React.useRef(0);
  const lockedScrollTopRef = React.useRef<number | null>(null);
  const previousLastMessageKeyRef = React.useRef<string | undefined>(undefined);
  const previousMessageCountRef = React.useRef(0);
  const handledTargetMessageIdRef = React.useRef<string | null>(null);
  const scrollToBottomOnNextUpdateRef = React.useRef(false);
  // Mirror isLoading into a ref so the ResizeObservers (which subscribe once)
  // can skip reacting while the skeleton is up — reacting to height churn under
  // a streaming-in list is what makes the timeline thrash on entry.
  const isLoadingRef = React.useRef(isLoading);
  isLoadingRef.current = isLoading;
  // Mirror isFetchingOlder so the viewport ResizeObserver (subscribes once) can
  // see the live value: the load-older path owns scroll position across its
  // whole fetch+restore window, so the observer must not run a competing
  // restore while a fetch is in flight (see the resize handler below).
  const isFetchingOlderRef = React.useRef(isFetchingOlder);
  isFetchingOlderRef.current = isFetchingOlder;
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<
    string | null
  >(null);
  const [newMessageCount, setNewMessageCount] = React.useState(0);

  const resetScrollTracking = React.useCallback(() => {
    hasInitializedRef.current = false;
    shouldStickToBottomRef.current = true;
    isAtBottomRef.current = true;
    isProgrammaticBottomScrollRef.current = false;
    previousTimelineHeightRef.current = null;
    previousScrollTopRef.current = 0;
    lockedScrollTopRef.current = null;
    previousLastMessageKeyRef.current = undefined;
    previousMessageCountRef.current = 0;
    handledTargetMessageIdRef.current = null;
    scrollToBottomOnNextUpdateRef.current = false;
    setIsAtBottom(true);
    setHighlightedMessageId(null);
    setNewMessageCount(0);
  }, []);

  const pinToBottom = React.useCallback(
    ({ clearNewMessageCount = false }: PinToBottomOptions = {}) => {
      shouldStickToBottomRef.current = true;
      isAtBottomRef.current = true;
      setIsAtBottom((current) => (current ? current : true));

      if (clearNewMessageCount) {
        setNewMessageCount(0);
      }
    },
    [],
  );

  const setObservedBottomState = React.useCallback((atBottom: boolean) => {
    shouldStickToBottomRef.current = atBottom;
    isAtBottomRef.current = atBottom;
    setIsAtBottom((current) => (current === atBottom ? current : atBottom));

    if (atBottom) {
      setNewMessageCount(0);
    }
  }, []);

  const unpinFromBottom = React.useCallback((scrollTop: number) => {
    shouldStickToBottomRef.current = false;
    isAtBottomRef.current = false;
    isProgrammaticBottomScrollRef.current = false;
    previousScrollTopRef.current = scrollTop;
    setIsAtBottom(false);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId is intentionally the sole trigger — we reset all scroll state when the channel changes
  React.useLayoutEffect(() => {
    resetScrollTracking();
  }, [channelId, resetScrollTracking]);

  const latestMessage =
    messages.length > 0 ? messages[messages.length - 1] : undefined;
  const latestMessageKey = selectLatestMessageKey(messages);

  const scrollToBottomOnNextUpdate = React.useCallback(() => {
    scrollToBottomOnNextUpdateRef.current = true;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: timelineRef is a stable React ref passed from the parent — its identity never changes
  const syncScrollState = React.useCallback(() => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }

    const scrollTop = lockedScrollTopRef.current ?? timeline.scrollTop;
    const atBottom = isNearBottom(timeline);
    const movedAwayFromBottom = scrollTop + 1 < previousScrollTopRef.current;

    if (isProgrammaticBottomScrollRef.current) {
      previousScrollTopRef.current = scrollTop;

      if (movedAwayFromBottom) {
        isProgrammaticBottomScrollRef.current = false;
      } else if (!atBottom) {
        pinToBottom();
        return;
      } else {
        isProgrammaticBottomScrollRef.current = false;
        pinToBottom({ clearNewMessageCount: true });
        return;
      }
    }

    if (shouldStickToBottomRef.current && !atBottom && !movedAwayFromBottom) {
      previousScrollTopRef.current = scrollTop;
      pinToBottom({ clearNewMessageCount: true });
      return;
    }

    previousScrollTopRef.current = scrollTop;
    setObservedBottomState(atBottom);
  }, [pinToBottom, setObservedBottomState]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: timelineRef is a stable React ref — its identity never changes
  const restoreScrollPosition = React.useCallback(
    (scrollTop: number) => {
      const timeline = timelineRef.current;

      if (!timeline) {
        return;
      }

      isProgrammaticBottomScrollRef.current = false;
      lockedScrollTopRef.current = scrollTop;

      const restore = (remainingFrames: number) => {
        timeline.scrollTop = scrollTop;

        if (remainingFrames > 0) {
          requestAnimationFrame(() => {
            restore(remainingFrames - 1);
          });
          return;
        }

        lockedScrollTopRef.current = null;
        previousScrollTopRef.current = timeline.scrollTop;
        syncScrollState();
      };

      restore(2);
    },
    [syncScrollState],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: timelineRef is a stable React ref — its identity never changes
  const scrollToBottom = React.useCallback(
    (behavior: ScrollBehavior) => {
      const timeline = timelineRef.current;

      if (!timeline) {
        return;
      }

      isProgrammaticBottomScrollRef.current = true;

      // Virtualized timeline: the last item lives off-screen with no DOM node,
      // so aim the virtualizer at it by index ("end" align). The library's own
      // reconcile loop chases the bottom as rows mount and measure, replacing
      // the synchronous `scrollHeight` read that forced a full reflow on entry.
      if (virtualizer) {
        const lastIndex = virtualizer.itemCount - 1;
        if (lastIndex >= 0) {
          virtualizer
            .getVirtualizer()
            ?.scrollToIndex(lastIndex, { align: "end", behavior });
        }
        lockedScrollTopRef.current = null;
        previousScrollTopRef.current = timeline.scrollTop;
        pinToBottom({ clearNewMessageCount: true });
        requestAnimationFrame(() => {
          previousScrollTopRef.current = timeline.scrollTop;
          syncScrollState();
        });
        return;
      }

      const alignToBottom = (nextBehavior: ScrollBehavior) => {
        bottomAnchorRef.current?.scrollIntoView({
          block: "end",
          behavior: nextBehavior,
        });
        timeline.scrollTo({
          top: timeline.scrollHeight,
          behavior: nextBehavior,
        });
      };

      alignToBottom(behavior);
      lockedScrollTopRef.current = null;
      previousScrollTopRef.current = timeline.scrollTop;
      pinToBottom({ clearNewMessageCount: true });

      if (behavior === "smooth") {
        requestAnimationFrame(() => {
          previousScrollTopRef.current = timeline.scrollTop;
          syncScrollState();
        });
        return;
      }

      const settleAlignment = (remainingFrames: number) => {
        requestAnimationFrame(() => {
          alignToBottom("auto");
          previousScrollTopRef.current = timeline.scrollTop;

          if (remainingFrames > 0) {
            settleAlignment(remainingFrames - 1);
            return;
          }

          syncScrollState();
        });
      };

      settleAlignment(2);
    },
    [pinToBottom, syncScrollState, virtualizer],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: timelineRef is a stable React ref — its identity never changes
  React.useEffect(() => {
    const timeline = timelineRef.current;

    if (!timeline || typeof ResizeObserver === "undefined") {
      return;
    }

    previousTimelineHeightRef.current = timeline.clientHeight;
    previousScrollTopRef.current = timeline.scrollTop;

    const observer = new ResizeObserver(([entry]) => {
      const previousTimelineHeight = previousTimelineHeightRef.current;
      const nextTimelineHeight = entry.contentRect.height;
      previousTimelineHeightRef.current = nextTimelineHeight;

      // Track height while loading, but don't scroll — the init layout-effect
      // owns the first scroll once content settles.
      if (isLoadingRef.current) {
        return;
      }

      if (
        previousTimelineHeight === null ||
        Math.abs(nextTimelineHeight - previousTimelineHeight) < 1
      ) {
        return;
      }

      if (shouldStickToBottomRef.current || isAtBottomRef.current) {
        scrollToBottom("auto");
        return;
      }

      // The load-older path owns scroll position across its whole window. Two
      // guards keep this observer from running a competing restore — without
      // them the spinner's clientHeight 720->590 shift fires here and restores
      // to previousScrollTopRef.current (0, since the user scrolled to the top
      // to trigger), collapsing the anchor.
      //
      // Guard 1 — fetch in flight, lock not yet set: the spinner mounts BEFORE
      // the fetch resolves and calls restoreScrollPosition, so lockedScrollTop
      // is still null on this fire. Skip entirely; the load-older path restores
      // once the page arrives.
      if (isFetchingOlderRef.current) {
        return;
      }

      // Guard 2 — restore running, lock set: a later shift (e.g. spinner
      // unmount) can fire while restoreScrollPosition's rAF loop holds its
      // target in lockedScrollTopRef. Defer to that target so both aim at the
      // same scrollTop instead of fighting frame-by-frame.
      restoreScrollPosition(
        lockedScrollTopRef.current ?? previousScrollTopRef.current,
      );
    });

    observer.observe(timeline);

    return () => {
      observer.disconnect();
    };
  }, [restoreScrollPosition, scrollToBottom]);

  React.useEffect(() => {
    const content = contentRef.current;

    if (!content || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (isLoadingRef.current) {
        return;
      }
      if (shouldStickToBottomRef.current) {
        scrollToBottom("auto");
        return;
      }

      syncScrollState();
    });

    observer.observe(content);

    return () => {
      observer.disconnect();
    };
  }, [scrollToBottom, syncScrollState]);

  React.useLayoutEffect(() => {
    if (!hasInitializedRef.current) {
      if (isLoading) {
        return;
      }

      if (targetMessageId) {
        const timeline = timelineRef.current;
        unpinFromBottom(timeline?.scrollTop ?? 0);
      } else {
        scrollToBottom("auto");
      }
      hasInitializedRef.current = true;
      previousLastMessageKeyRef.current = latestMessageKey;
      previousMessageCountRef.current = messages.length;
      return;
    }

    const previousLastMessageKey = previousLastMessageKeyRef.current;
    const previousMessageCount = previousMessageCountRef.current;
    const hasNewLatestMessage =
      latestMessage !== undefined &&
      latestMessageKey !== previousLastMessageKey;

    if (!hasNewLatestMessage) {
      previousLastMessageKeyRef.current = latestMessageKey;
      previousMessageCountRef.current = messages.length;
      return;
    }

    const shouldHonorExplicitBottomRequest =
      scrollToBottomOnNextUpdateRef.current;
    scrollToBottomOnNextUpdateRef.current = false;

    const autoScrollBehavior = selectLatestMessageAutoScrollBehavior({
      hasExplicitBottomRequest: shouldHonorExplicitBottomRequest,
      isAtBottom: isAtBottomRef.current,
      shouldStickToBottom: shouldStickToBottomRef.current,
      targetMessageId,
    });

    if (autoScrollBehavior) {
      scrollToBottom(autoScrollBehavior);
    } else {
      setNewMessageCount((current) => {
        const addedMessages = Math.max(
          1,
          messages.length - previousMessageCount,
        );
        return current + addedMessages;
      });
    }

    previousLastMessageKeyRef.current = latestMessageKey;
    previousMessageCountRef.current = messages.length;
  }, [
    isLoading,
    latestMessage,
    latestMessageKey,
    messages.length,
    scrollToBottom,
    targetMessageId,
    timelineRef,
    unpinFromBottom,
  ]);

  // Shared highlight lifecycle for both scroll paths: highlight the row, clear
  // the unread count, and auto-fade the highlight after 2s.
  const beginHighlight = React.useCallback((messageId: string) => {
    setHighlightedMessageId(messageId);
    setNewMessageCount(0);
    window.setTimeout(() => {
      setHighlightedMessageId((current) =>
        current === messageId ? null : current,
      );
    }, 2_000);
  }, []);

  const clearHighlight = React.useCallback((messageId: string) => {
    setHighlightedMessageId((current) =>
      current === messageId ? null : current,
    );
  }, []);

  // Virtualized scroll path: re-aim the virtualizer by index, re-resolving the
  // target id every frame so a mid-settle prepend/delete can't strand it.
  const convergent = useConvergentScrollToMessage(
    virtualizer?.getVirtualizer ?? (() => null),
    {
      indexByMessageId: virtualizer?.indexByMessageId ?? new Map(),
      align: "center",
      onConverged: (messageId) => onTargetReached?.(messageId),
      onAbandoned: clearHighlight,
    },
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: timelineRef is a stable React ref — its identity never changes
  const scrollToMessage = React.useCallback(
    (messageId: string) => {
      const timeline = timelineRef.current;
      if (!timeline) {
        return false;
      }

      // Virtualized timeline: off-screen rows have no DOM node, so resolve the
      // target through the index map and drive the convergence loop instead of
      // `querySelector` + `scrollIntoView`.
      if (virtualizer) {
        unpinFromBottom(timeline.scrollTop);
        beginHighlight(messageId);
        // Returns false only when the id is absent from the data (never merely
        // off-screen), matching the deep-link effect's found-in-data contract.
        return convergent.scrollToMessage(messageId);
      }

      const targetElement = timeline.querySelector<HTMLElement>(
        `[data-message-id="${messageId}"]`,
      );
      if (!targetElement) {
        return false;
      }

      unpinFromBottom(timeline.scrollTop);
      beginHighlight(messageId);

      const alignToTarget = (remainingFrames: number) => {
        targetElement.scrollIntoView({
          block: "center",
          behavior: "auto",
        });
        previousScrollTopRef.current = timeline.scrollTop;

        if (remainingFrames > 0) {
          requestAnimationFrame(() => {
            alignToTarget(remainingFrames - 1);
          });
          return;
        }

        onTargetReached?.(messageId);
      };

      alignToTarget(2);

      return true;
    },
    [beginHighlight, convergent, onTargetReached, unpinFromBottom, virtualizer],
  );

  React.useEffect(() => {
    if (!targetMessageId) {
      handledTargetMessageIdRef.current = null;
      setHighlightedMessageId(null);
      return;
    }

    if (handledTargetMessageIdRef.current === targetMessageId || isLoading) {
      return;
    }

    // Deep-link decision delegated to a pure, lib-tested helper: only attempt the
    // jump once the target actually exists in THIS (deferred) snapshot. If it
    // doesn't, the row hasn't committed yet — bail and let the next snapshot that
    // includes it drive the jump. This reads the same `messages` snapshot the
    // list rendered, which closes the tearing race.
    if (!resolveDeepLinkTarget(messages, targetMessageId).resolved) {
      return;
    }

    if (!scrollToMessage(targetMessageId)) {
      return;
    }

    handledTargetMessageIdRef.current = targetMessageId;
  }, [isLoading, messages, scrollToMessage, targetMessageId]);

  return {
    bottomAnchorRef,
    contentRef,
    highlightedMessageId,
    isAtBottom,
    newMessageCount,
    restoreScrollPosition,
    scrollToBottom,
    scrollToBottomOnNextUpdate,
    scrollToMessage,
    syncScrollState,
  };
}

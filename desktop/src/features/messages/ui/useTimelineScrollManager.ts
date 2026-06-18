import * as React from "react";

import {
  captureReflowAnchor,
  isNearBottom,
  resolveDeepLinkTarget,
  resolveReflowAnchorScrollTop,
  selectLatestMessageKey,
} from "@/features/messages/lib/timelineSnapshot";
import type { TimelineMessage } from "@/features/messages/types";

type UseTimelineScrollManagerOptions = {
  channelId?: string | null;
  isLoading: boolean;
  messages: TimelineMessage[];
  onTargetReached?: (messageId: string) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  targetMessageId?: string | null;
  /**
   * True when the right auxiliary pane occupies the split layout (any of the
   * thread/agent-session/profile panels). Flipping this changes the timeline
   * column width and re-wraps every message; we anchor the viewport across that
   * reflow. See the reflow-anchor layout effect below.
   */
  auxiliaryPaneOpen?: boolean;
};

type PinToBottomOptions = {
  clearNewMessageCount?: boolean;
};

export function useTimelineScrollManager({
  channelId,
  isLoading,
  messages,
  onTargetReached,
  scrollContainerRef,
  targetMessageId,
  auxiliaryPaneOpen = false,
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
  const reflowAnchorRef = React.useRef<ReturnType<
    typeof captureReflowAnchor
  > | null>(null);
  const previousAuxiliaryPaneOpenRef = React.useRef(auxiliaryPaneOpen);
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
    reflowAnchorRef.current = null;
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
    [pinToBottom, syncScrollState],
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

      restoreScrollPosition(previousScrollTopRef.current);
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

  // Hold the viewport steady across the width reflow caused by opening/closing
  // the right auxiliary pane. The pane is a fixed-width sibling of the flex-1
  // timeline, so toggling it re-wraps every message; native scroll anchoring is
  // off (`[overflow-anchor:none]`) and the height ResizeObserver bails on a
  // width-only change, so this is the seam that re-anchors.
  //
  // Ordering is load-bearing: this layout effect runs AFTER the DOM has already
  // reflowed, so the pre-flip geometry must come from `reflowAnchorRef`, which
  // the PREVIOUS commit captured while the pane was still in its prior state.
  // We therefore READ the old anchor and (on a flip) restore to it FIRST, THEN
  // refresh the ref for the next flip — never recapture before restoring, and
  // never capture in the render body (a discarded speculative render would
  // poison the ref with geometry that never painted).
  React.useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }

    const paneFlipped =
      auxiliaryPaneOpen !== previousAuxiliaryPaneOpenRef.current;
    previousAuxiliaryPaneOpenRef.current = auxiliaryPaneOpen;

    // Bottom-stuck users need no handling here: the content ResizeObserver
    // already re-pins them to bottom on the reflow's height change, and its
    // `settleAlignment` re-targets a stable scrollHeight each frame, so there
    // is no inter-frame movement to suppress. Only the mid-scroll case drifts.
    const isBottomStuck =
      shouldStickToBottomRef.current || isAtBottomRef.current;

    if (paneFlipped && !isBottomStuck && lockedScrollTopRef.current === null) {
      // Mid-scroll: re-resolve the cached anchor by id against the freshly
      // reflowed DOM, then restore through the single lock owner. No-op while
      // another restore/settle holds the lock.
      const anchor = reflowAnchorRef.current;
      const element = anchor
        ? timeline.querySelector<HTMLElement>(
            `[data-message-id="${anchor.messageId}"]`,
          )
        : null;

      if (anchor && element) {
        restoreScrollPosition(
          resolveReflowAnchorScrollTop(
            timeline.scrollTop,
            element.getBoundingClientRect().top,
            timeline.getBoundingClientRect().top,
            anchor.offsetFromContainerTop,
          ),
        );
      }
    }

    // Refresh the anchor for the next flip. Skip while a restore is in flight so
    // we cache the settled position, not a mid-restore frame.
    if (lockedScrollTopRef.current === null) {
      reflowAnchorRef.current = captureReflowAnchor(timeline);
    }
  });

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

    if (
      !targetMessageId &&
      (shouldStickToBottomRef.current ||
        isAtBottomRef.current ||
        latestMessage.accent)
    ) {
      scrollToBottom(latestMessage.accent ? "smooth" : "auto");
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: timelineRef is a stable React ref — its identity never changes
  const scrollToMessage = React.useCallback(
    (messageId: string) => {
      const timeline = timelineRef.current;
      if (!timeline) {
        return false;
      }

      const targetElement = timeline.querySelector<HTMLElement>(
        `[data-message-id="${messageId}"]`,
      );
      if (!targetElement) {
        return false;
      }

      unpinFromBottom(timeline.scrollTop);
      setHighlightedMessageId(messageId);
      setNewMessageCount(0);

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

      window.setTimeout(() => {
        setHighlightedMessageId((current) =>
          current === messageId ? null : current,
        );
      }, 2_000);

      return true;
    },
    [onTargetReached, unpinFromBottom],
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
    scrollToMessage,
    syncScrollState,
  };
}

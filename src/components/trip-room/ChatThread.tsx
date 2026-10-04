"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CardStatus, CardType } from "@prisma/client";
import { MessageRow, type MessageAttachment, type MessageReactionView } from "./MessageRow";
import { FailedClockwiseMessage } from "./FailedClockwiseMessage";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { Composer } from "./Composer";
import { AskClockwise } from "./AskClockwise";
import { ProposalCard, type ProposalCardData } from "./ProposalCard";
import { CollectionCard } from "@/components/payments/CollectionCard";
import type { CollectionView } from "@/lib/payments/obligations";
import { ActionCardMessage } from "@/components/action-cards/ActionCardMessage";
import type { CardPerson } from "@/components/action-cards/ClockwiseActionCard";

export type ChatThreadMessage = {
  id: string;
  senderId?: string;
  senderName: string;
  content: string;
  timestamp: Date;
  isClockwise: boolean;
  failed: boolean;
  cardType: CardType | null;
  cardData: string | null;
  cardStatus: CardStatus | null;
  attachments: MessageAttachment[];
  proposal: ProposalCardData | null;
  reactions?: MessageReactionView[];
};

export function ChatThread({
  tripId,
  channel,
  messages,
  roster,
  currentUserId,
  organiserId,
  organiserName = "the organiser",
  postAction,
  runAgentAction,
  placeholder,
  emptyText,
  suggestions,
  header,
  collections = [],
}: {
  tripId: string;
  channel: "GROUP" | "PRIVATE";
  messages: ChatThreadMessage[];
  roster: CardPerson[];
  currentUserId: string | null;
  organiserId: string;
  organiserName?: string;
  // Fast: persists the human message only, returns immediately.
  postAction: (formData: FormData) => Promise<{ senderId: string } | void>;
  // Slow: the actual agent turn. Deliberately a SEPARATE transition from
  // the send itself, so the composer re-enables as soon as the message is
  // saved rather than waiting for Clockwise to finish thinking.
  runAgentAction: (senderId: string) => Promise<void>;
  placeholder: string;
  emptyText: string;
  suggestions?: string[];
  // Rendered at the top of the scrolling thread (the Trip Room's editorial header).
  header?: React.ReactNode;
  // Live group-payment state; a payment card in the thread renders from this, never from its stale snapshot.
  collections?: CollectionView[];
}) {
  // Only covers the fast DB write — the composer is disabled for
  // milliseconds, not for however long Gemini takes.
  const [isSending, startSendTransition] = useTransition();
  // Covers the agent turn — drives the "thinking" indicator only, never
  // the composer's disabled state, so a human can keep typing/sending
  // while Clockwise is still working on a previous message.
  const [isThinking, startThinkTransition] = useTransition();

  // New messages (yours, or a friend's arriving live) keep the latest in view - but only if you
  // were already near the bottom, so reading history is never yanked away. A short thread opens
  // at the top so the header is seen; a long one opens at the latest message.
  const scroller = useRef<HTMLDivElement>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const count = messages.length;
    if (seen.current === null) {
      if (el.scrollHeight - el.clientHeight > 900) el.scrollTop = el.scrollHeight;
    } else if (count > seen.current && el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    seen.current = count;
  }, [messages.length]);

  // Whether the person is talking TO Clockwise: always in their private room, and in the group only when they
  // name it. That decides whether "Clockwise is thinking" appears (background work stays silent).
  const [awaitingClockwise, setAwaitingClockwise] = useState(false);

  // Urgent (event-handler) update: the indicator appears the instant Send is pressed.
  function noticeSend(content: string) {
    if (channel === "PRIVATE" || /\bclockwise\b/i.test(content)) setAwaitingClockwise(true);
  }

  useEffect(() => {
    if (awaitingClockwise) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [awaitingClockwise]);

  function handleSend(formData: FormData) {
    startSendTransition(async () => {
      const result = await postAction(formData);
      if (!result) {
        setAwaitingClockwise(false);
        return;
      }
      startThinkTransition(async () => {
        try {
          await runAgentAction(result.senderId);
        } finally {
          setAwaitingClockwise(false);
        }
      });
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {header}
        <div className="flex flex-1 flex-col space-y-3 px-4 pb-4 pt-2">
        {messages.map((message, index) => {
          const prev = index > 0 ? messages[index - 1] : null;
          const plain = (m: ChatThreadMessage | null) => Boolean(m) && !m!.proposal && !m!.failed && !(m!.cardType && m!.cardData) && !m!.isClockwise;
          const grouped = !message.isClockwise && plain(message) && plain(prev) && prev!.senderId === message.senderId && message.timestamp.getTime() - prev!.timestamp.getTime() < 5 * 60_000;
          const collectionId = message.cardData && message.cardData.includes('"collection":true') ? (/"collectionId":"([^"]+)"/.exec(message.cardData)?.[1] ?? null) : null;
          if (collectionId) {
            const c = collections.find((x) => x.id === collectionId);
            return c ? <CollectionCard key={message.id} c={c} /> : null;
          }
          return message.proposal ? (
            <ProposalCard
              key={message.id}
              proposal={message.proposal}
              viewerId={currentUserId}
              isOrganiser={currentUserId === organiserId}
              organiserName={organiserName}
            />
          ) : message.failed ? (
            <FailedClockwiseMessage
              key={message.id}
              messageId={message.id}
              content={message.content}
              timestamp={message.timestamp}
            />
          ) : message.cardType && message.cardData && message.cardStatus ? (
            <ActionCardMessage
              key={message.id}
              tripId={tripId}
              messageId={message.id}
              cardType={message.cardType}
              cardStatus={message.cardStatus}
              cardData={message.cardData}
              roster={roster}
              currentUserId={currentUserId}
              organiserId={organiserId}
            />
          ) : (
            <MessageRow
              key={message.id}
              senderId={message.senderId}
              senderName={message.senderName}
              content={message.content}
              timestamp={message.timestamp}
              isClockwise={message.isClockwise}
              attachments={message.attachments}
              messageId={message.id}
              reactions={message.reactions}
              reactable={channel === "GROUP"}
              viewerId={currentUserId}
              grouped={grouped}
            />
          );
        })}
        {messages.length === 0 && !awaitingClockwise && (
          <p className="pt-12 text-center text-sm text-muted-foreground">{emptyText}</p>
        )}
        {/* Group chat is human-first: Clockwise works silently there. A working
            state belongs only to the private Clockwise conversation. */}
        {awaitingClockwise && <ThinkingIndicator />}
        </div>
      </div>

      {channel === "GROUP" && <AskClockwise tripId={tripId} />}
      <Composer
        tripId={tripId}
        channel={channel}
        action={handleSend}
        placeholder={placeholder}
        onSubmitStart={noticeSend}
        disabled={isSending}
        suggestions={suggestions}
      />
    </div>
  );
}

"use client";

import { useTransition } from "react";
import type { CardStatus, CardType } from "@prisma/client";
import { MessageRow, type MessageAttachment } from "./MessageRow";
import { FailedClockwiseMessage } from "./FailedClockwiseMessage";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { Composer } from "./Composer";
import { ProposalCard, type ProposalCardData } from "./ProposalCard";
import { ActionCardMessage } from "@/components/action-cards/ActionCardMessage";
import type { CardPerson } from "@/components/action-cards/ClockwiseActionCard";

export type ChatThreadMessage = {
  id: string;
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
};

export function ChatThread({
  tripId,
  channel,
  messages,
  roster,
  currentUserId,
  organiserId,
  postAction,
  runAgentAction,
  placeholder,
  emptyText,
  suggestions,
}: {
  tripId: string;
  channel: "GROUP" | "PRIVATE";
  messages: ChatThreadMessage[];
  roster: CardPerson[];
  currentUserId: string | null;
  organiserId: string;
  // Fast: persists the human message only, returns immediately.
  postAction: (formData: FormData) => Promise<{ senderId: string } | void>;
  // Slow: the actual agent turn. Deliberately a SEPARATE transition from
  // the send itself, so the composer re-enables as soon as the message is
  // saved rather than waiting for Clockwise to finish thinking.
  runAgentAction: (senderId: string) => Promise<void>;
  placeholder: string;
  emptyText: string;
  suggestions?: string[];
}) {
  // Only covers the fast DB write — the composer is disabled for
  // milliseconds, not for however long Gemini takes.
  const [isSending, startSendTransition] = useTransition();
  // Covers the agent turn — drives the "thinking" indicator only, never
  // the composer's disabled state, so a human can keep typing/sending
  // while Clockwise is still working on a previous message.
  const [isThinking, startThinkTransition] = useTransition();

  function handleSend(formData: FormData) {
    startSendTransition(async () => {
      const result = await postAction(formData);
      if (!result) return;
      startThinkTransition(async () => {
        await runAgentAction(result.senderId);
      });
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((message) =>
          message.proposal ? (
            <ProposalCard
              key={message.id}
              proposal={message.proposal}
              viewerId={currentUserId}
              isOrganiser={currentUserId === organiserId}
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
            />
          ) : (
            <MessageRow
              key={message.id}
              senderName={message.senderName}
              content={message.content}
              timestamp={message.timestamp}
              isClockwise={message.isClockwise}
              attachments={message.attachments}
            />
          )
        )}
        {messages.length === 0 && !isThinking && (
          <p className="pt-12 text-center text-sm text-muted-foreground">{emptyText}</p>
        )}
        {isThinking && <ThinkingIndicator />}
      </div>

      <Composer
        tripId={tripId}
        channel={channel}
        action={handleSend}
        placeholder={placeholder}
        disabled={isSending}
        suggestions={suggestions}
      />
    </div>
  );
}

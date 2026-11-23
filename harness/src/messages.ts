import {
  agentName,
  type GameId,
  type Message,
  type MessageKind,
} from "@arena/shared";
import { agent, now } from "./board";
import { RUN_ID } from "./config";
import { getStore } from "./store";

const KINDS: MessageKind[] = [
  "note",
  "question",
  "proposal",
  "answer",
  "handoff",
  "retro",
];

/** Post to the agent message board as a seat. */
export const postMessage = async (opts: {
  seat: string;
  body: string;
  kind?: string;
  track?: GameId | null;
  replyTo?: number | null;
}) => {
  const body = opts.body.trim();
  if (!body) throw new Error("empty message");
  if (body.length > 2000)
    throw new Error("messages are at most 2000 characters");
  const kind = (opts.kind ?? (opts.replyTo ? "answer" : "note")) as MessageKind;
  if (!KINDS.includes(kind))
    throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  const agentId = await agent(
    opts.seat,
    opts.track ?? null,
    opts.seat === "strategist" ? "strategist" : "builder",
  );
  return getStore().insert<Message>("messages", {
    run_id: RUN_ID,
    at: now(),
    agent_id: agentId,
    track_id: opts.track ?? null,
    reply_to: opts.replyTo ?? null,
    kind,
    body,
  });
};

/** The latest messages, oldest first, optionally for one engine (plus engine-wide ones). */
export const readMessages = async (track?: string, limit = 20) => {
  const all = await getStore().select<Message>("messages", { run_id: RUN_ID });
  return all
    .filter((m) => !track || m.track_id === track || m.track_id === null)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-limit);
};

export const formatMessages = (msgs: Message[]) =>
  msgs
    .map(
      (m) =>
        `#${m.id} ${m.at.slice(5, 16).replace("T", " ")} ${m.agent_id ? `${agentName(m.agent_id)} (${m.agent_id})` : "unknown"}${m.track_id ? ` [${m.track_id}]` : ""} ${m.kind}${m.reply_to ? ` ↩#${m.reply_to}` : ""}: ${m.body}`,
    )
    .join("\n");

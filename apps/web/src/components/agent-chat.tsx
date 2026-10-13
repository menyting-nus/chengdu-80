import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@web-starter/ui/components/table";
import { Markdown, type MarkdownComponents } from "@tanstack/markdown/react";
import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useChat,
  fetchServerSentEvents,
  type ChatFetcher,
  type UIMessage,
} from "@tanstack/ai-react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Hammer,
  Square,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import { Separator } from "@web-starter/ui/components/separator";
import { Button } from "@web-starter/ui/components/button";
import { cn } from "@web-starter/ui/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@web-starter/ui/components/alert";
import { Bubble, BubbleContent } from "@web-starter/ui/components/bubble";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@web-starter/ui/components/collapsible";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@web-starter/ui/components/empty";
import { Field, FieldLabel } from "@web-starter/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@web-starter/ui/components/input-group";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@web-starter/ui/components/message";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@web-starter/ui/components/message-scroller";
import { api } from "../lib/client";
import { useRouter } from "@tanstack/react-router";
import { api as convexApi } from "@web-starter/backend/convex/_generated/api";
import { protocols, type Application, type ProductSpec } from "../lib/contracts";

const streamingExtensions = [streamingMarkdownExtension()];
const markdownComponents = {
  table: Table,
  thead: TableHeader,
  tbody: TableBody,
  tr: TableRow,
  th: TableHead,
  td: TableCell,
  pre: (props) => <pre {...props} className="max-w-full overflow-x-auto" />,
  ul: (props) => <ul {...props} className="list-disc pl-5" />,
  ol: (props) => <ol {...props} className="list-decimal pl-5" />,
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: (props) => <span>{props.alt ?? ""}</span>,
} satisfies MarkdownComponents;

type AgentChatProps = {
  app: Application | null;
  reactive?: boolean;
  messagesReady?: boolean;
  connected: boolean;
  disabled: boolean;
  modelName: string;
  onWorkspaceCreated: (app: Application) => void;
  onFinish: () => Promise<void> | void;
  onImport: () => void;
  onExample: (spec: ProductSpec) => void;
  onBusyChange?: (busy: boolean) => void;
};

type Part = UIMessage["parts"][number];
type ToolPart = Extract<Part, { type: "tool-call" }>;
type ToolGroup = { type: "tool-group"; calls: ToolPart[] };

// Keep each uninterrupted run of tools in one bucket between assistant text.
function groupToolParts(parts: Part[]) {
  const grouped: (Part | ToolGroup)[] = [];
  for (const part of parts) {
    if (part.type === "tool-call") {
      const previous = grouped.at(-1);
      if (previous?.type === "tool-group") previous.calls.push(part);
      else grouped.push({ type: "tool-group", calls: [part] });
    } else if ((part.type === "text" || part.type === "thinking") && part.content) {
      grouped.push(part);
    }
  }
  return grouped;
}

function inspect(value: unknown) {
  const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  return text.length > 5000 ? `${text.slice(0, 5000)}\n…` : text;
}

function toolTarget(args: string) {
  try {
    const input: unknown = JSON.parse(args);
    if (typeof input !== "object" || input === null) return "";
    for (const key of ["path", "file", "pluginId", "operationId", "command"]) {
      if (key in input) {
        const value: unknown = Reflect.get(input, key);
        if (typeof value === "string") return value.slice(0, 100);
      }
    }
  } catch {
    // Streaming arguments may not form JSON until the tool call finishes.
  }
  return "";
}

function ToolActivity({
  part,
  result,
}: {
  part: ToolPart;
  result?: Extract<Part, { type: "tool-result" }>;
}) {
  const failed = part.state === "error" || result?.state === "error";
  const finished = part.state === "complete" || result?.state === "complete";
  const target = toolTarget(part.arguments);
  const output: unknown = result?.content ?? part.output;
  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="h-auto w-full justify-start py-2" />}
      >
        {failed ? (
          <X data-icon="inline-start" />
        ) : finished ? (
          <Check data-icon="inline-start" />
        ) : (
          <Terminal data-icon="inline-start" />
        )}
        <span className="min-w-0 truncate">
          {part.name.replaceAll("_", " ")}
          {target ? ` · ${target}` : ""}
        </span>
        <span className="ml-auto shrink-0">
          {failed ? "Failed" : finished ? "Done" : "Running"}
        </span>
        <ChevronRight data-icon="inline-end" />
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 px-3 py-2">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
          {inspect(part.arguments)}
          {output !== undefined ? `\n\n${inspect(output)}` : ""}
          {result?.error ? `\n\n${result.error}` : ""}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);
  return (
    <MessageFooter>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied answer" : "Copy answer"}
        title={copied ? "Copied" : "Copy answer"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      {failed && <span role="status">Could not copy. Try again.</span>}
    </MessageFooter>
  );
}

function ToolActivityGroup({
  calls,
  results,
}: {
  calls: ToolPart[];
  results: Map<string, Extract<Part, { type: "tool-result" }>>;
}) {
  const running = calls.find(
    (call) =>
      call.state !== "complete" &&
      call.state !== "error" &&
      results.get(call.id)?.state !== "complete" &&
      results.get(call.id)?.state !== "error",
  );
  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger
        render={<Button variant="link" size="sm" className="h-auto justify-start p-0" />}
        aria-label={`Tool activity: ${calls.length} ${calls.length === 1 ? "call" : "calls"}`}
      >
        <Hammer data-icon="inline-start" />
        <span className="min-w-0 truncate">
          {running ? `${running.name.replaceAll("_", " ")} · ` : ""}
          {calls.length} {calls.length === 1 ? "tool call" : "tool calls"}
        </span>
        <ChevronRight data-icon="inline-end" />
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 py-2">
        {calls.map((call) => (
          <ToolActivity key={call.id} part={call} result={results.get(call.id)} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ConversationMessage({
  message,
  results,
  compact = false,
}: {
  message: UIMessage;
  compact?: boolean;
  results: Map<string, Extract<Part, { type: "tool-result" }>>;
}) {
  const user = message.role === "user";
  const answer = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("\n\n");
  const visibleParts = groupToolParts(message.parts);
  if (!visibleParts.length) return null;
  return (
    <Message align={user ? "end" : "start"}>
      <MessageContent className="min-w-0">
        {!compact && <MessageHeader>{user ? "You" : "Assistant"}</MessageHeader>}
        {visibleParts.map((part, index) => {
          if (part.type === "text")
            return part.content ? (
              <Bubble
                key={index}
                variant={user ? "secondary" : "ghost"}
                align={user ? "end" : "start"}
              >
                <BubbleContent className={user ? "whitespace-pre-wrap" : "flex flex-col gap-3"}>
                  {user ? (
                    part.content
                  ) : (
                    <Markdown
                      extensions={streamingExtensions}
                      components={markdownComponents}
                      frontmatter={false}
                      headingIds={false}
                    >
                      {part.content}
                    </Markdown>
                  )}
                </BubbleContent>
              </Bubble>
            ) : null;
          if (part.type === "tool-group")
            return (
              <ToolActivityGroup key={part.calls[0]!.id} calls={part.calls} results={results} />
            );
          if (part.type === "thinking" && part.content)
            return (
              <Collapsible key={index}>
                <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
                  <ChevronRight data-icon="inline-start" />
                  Thinking
                </CollapsibleTrigger>
                <CollapsibleContent className="whitespace-pre-wrap text-sm">
                  {part.content}
                </CollapsibleContent>
              </Collapsible>
            );
          return null;
        })}
        {!user && answer && <CopyAnswer text={answer} />}
      </MessageContent>
    </Message>
  );
}

type Turn = { user: UIMessage; replies: UIMessage[] };
function conversationTurns(messages: UIMessage[]) {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") turns.push({ user: message, replies: [] });
    else if (message.role === "assistant") turns.at(-1)?.replies.push(message);
  }
  return turns;
}
function milliseconds(value: Date | string | undefined) {
  if (!value) return undefined;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : undefined;
}
function elapsedLabel(duration: number) {
  const seconds = Math.max(0, Math.floor(duration / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

// One user turn owns all intermediate model messages and tool events. The final
// text after the last tool result is the model's summary, never a client-written reply.
function ConversationTurn({
  turn,
  active,
  timing,
  results,
  stopped,
}: {
  turn: Turn;
  active: boolean;
  timing?: NonNullable<Application["turns"]>[number];
  results: Map<string, Extract<Part, { type: "tool-result" }>>;
  stopped: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) {
      setExpanded(false);
      setNow(Date.now());
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const parts = turn.replies.flatMap((message) => message.parts);
  const lastWork = parts.reduce(
    (last, part, index) =>
      part.type === "tool-call" || part.type === "tool-result" || part.type === "thinking"
        ? index
        : last,
    -1,
  );
  const start = milliseconds(timing?.startedAt) ?? milliseconds(turn.user.createdAt);
  const end = milliseconds(timing?.completedAt) ?? milliseconds(turn.replies.at(-1)?.createdAt);
  const duration = start !== undefined ? elapsedLabel((active ? now : (end ?? now)) - start) : "";
  const interrupted = stopped || timing?.status === "stopped" || timing?.status === "error";
  const label = active
    ? "Working"
    : stopped || timing?.status === "stopped"
      ? "Stopped"
      : timing?.status === "error"
        ? "Work failed"
        : "Worked";
  const work = {
    id: `${turn.user.id}-work`,
    role: "assistant" as const,
    parts: active || interrupted ? parts : parts.slice(0, lastWork + 1),
  };
  const summary = {
    id: `${turn.user.id}-summary`,
    role: "assistant" as const,
    parts: active || interrupted ? [] : lastWork >= 0 ? parts.slice(lastWork + 1) : parts,
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ConversationMessage message={turn.user} results={results} />
      {(active || interrupted || lastWork >= 0) && (
        <Collapsible open={active || expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger
            render={<Button variant="link" size="sm" className="h-auto justify-start p-0" />}
            aria-label={`${label}${duration ? ` for ${duration}` : ""}`}
          >
            {label}
            {duration ? ` for ${duration}` : ""}
            <ChevronRight data-icon="inline-end" />
          </CollapsibleTrigger>
          <CollapsibleContent className="min-w-0 py-2">
            <ConversationMessage message={work} results={results} compact />
          </CollapsibleContent>
        </Collapsible>
      )}
      {!active && lastWork >= 0 && <Separator />}
      {!!summary.parts.length && (
        <ConversationMessage message={summary} results={results} compact />
      )}
    </div>
  );
}

// The component keeps its identity when the first prompt creates its workspace.
// Remount it only when the user explicitly switches to another conversation.
function LocalAgentChat(props: AgentChatProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const appId = useRef(props.app?.id);
  const initialMessages = useRef(props.app?.conversation ?? []);
  const [prompt, setPrompt] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [stoppedTurn, setStoppedTurn] = useState<string>();
  const fetcher = useCallback<ChatFetcher>(async ({ messages, threadId, runId }, { signal }) => {
    if (!appId.current) {
      const user = [...messages].reverse().find((message) => message.role === "user");
      const text =
        user?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.content)
          .join("\n") ?? "";
      const workspace = await api<Application>({ action: "create-workspace", prompt: text });
      appId.current = workspace.id;
      callbacks.current.onWorkspaceCreated(workspace);
    }
    signal.throwIfAborted();
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: appId.current, messages: messages.slice(-1), threadId, runId }),
      signal,
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `Chat request failed (${response.status})`;
      throw new Error(detail);
    }
    return response;
  }, []);
  const chat = useChat({
    fetcher,
    initialMessages: initialMessages.current,
    onChunk: (chunk) => {
      if (!callbacks.current.reactive && chunk.type === "TOOL_CALL_RESULT")
        void callbacks.current.onFinish();
    },
    onFinish: () => {
      void Promise.resolve(callbacks.current.onFinish()).catch((error: unknown) =>
        setLocalError(error instanceof Error ? error.message : "Could not refresh the workspace"),
      );
    },
  });
  useEffect(() => {
    callbacks.current.onBusyChange?.(chat.isLoading);
    return () => callbacks.current.onBusyChange?.(false);
  }, [chat.isLoading]);
  const submit = () => {
    const text = prompt.trim();
    if (!text || props.disabled || !props.connected) return;
    if (chat.isLoading) {
      setStoppedTurn(conversationTurns(chat.messages).at(-1)?.user.id);
      chat.stop();
    }
    setPrompt("");
    setLocalError(undefined);
    void chat
      .sendMessage(text)
      .catch((error: unknown) =>
        setLocalError(error instanceof Error ? error.message : "Could not send message"),
      );
  };
  return (
    <AgentChatView
      props={props}
      prompt={prompt}
      setPrompt={setPrompt}
      messages={chat.messages}
      loading={chat.isLoading}
      error={localError ?? chat.error?.message}
      submit={submit}
      stoppedTurn={stoppedTurn}
      stop={() => {
        setStoppedTurn(conversationTurns(chat.messages).at(-1)?.user.id);
        chat.stop();
        void callbacks.current.onFinish();
      }}
    />
  );
}

// Convex owns the transcript. This transport consumes SSE only for lifecycle and
// errors; it deliberately keeps no second message buffer for the sending tab.
function ConvexAgentChat(props: AgentChatProps) {
  const client = useRouter().options.context.convexClient!;
  const callbacks = useRef(props);
  callbacks.current = props;
  const appId = useRef(props.app?.id);
  if (props.app?.id) appId.current = props.app.id;
  const controller = useRef<AbortController | null>(null);
  const requestedTurn = useRef<string | undefined>(undefined);
  const [prompt, setPrompt] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string>();
  const active = props.app?.agentTurn;
  const loading = requesting || active?.status === "running" || active?.status === "queued";
  useEffect(() => {
    if (active?.status === "stopped" && active.id === requestedTurn.current) {
      controller.current?.abort();
      setRequesting(false);
    }
  }, [active?.id, active?.status]);
  useEffect(() => {
    callbacks.current.onBusyChange?.(loading);
    return () => callbacks.current.onBusyChange?.(false);
  }, [loading]);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (appId.current && requestedTurn.current) {
        void client
          .mutation(convexApi.platform.stopTurn, {
            appId: appId.current,
            turnId: requestedTurn.current,
          })
          .catch(() => undefined);
      }
    },
    [client],
  );
  async function submit() {
    const content = prompt.trim();
    if (!content || props.disabled || !props.connected) return;
    if (requesting && !appId.current) return;
    // Existing threads hydrate after the initial status-only page bootstrap.
    // Read their subscribed identity before deciding to create a new workspace.
    appId.current = callbacks.current.app?.id ?? appId.current;
    // Interrupt this tab's transport; Convex atomically records the replacement
    // turn and Node waits for the previous writer to finish before continuing.
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRequesting(true);
    setError(undefined);
    const messageId = crypto.randomUUID();
    requestedTurn.current = messageId;
    try {
      if (!appId.current) {
        const workspace = await client.mutation(convexApi.platform.createWorkspace, {
          appId: crypto.randomUUID(),
          prompt: content,
          messageId,
        });
        appId.current = workspace.id;
        callbacks.current.onWorkspaceCreated(workspace);
      } else {
        await client.mutation(convexApi.platform.sendMessage, {
          appId: appId.current,
          messageId,
          content,
        });
      }
      setPrompt("");
      if (abort.signal.aborted) {
        await client.mutation(convexApi.platform.stopTurn, {
          appId: appId.current!,
          turnId: messageId,
        });
        return;
      }
      const message: UIMessage = {
        id: messageId,
        role: "user",
        parts: [{ type: "text", content }],
      };
      const stream = fetchServerSentEvents("/api/ai/chat", {
        // Keep the existing Node request contract; the adapter otherwise emits
        // AG-UI wire messages and nests appId inside forwardedProps.
        fetchClient: async (url, options) => {
          const response = await fetch(url, {
            ...options,
            body: JSON.stringify({ appId: appId.current, messages: [message] }),
          });
          if (!response.ok) {
            const body: unknown = await response.json().catch(() => null);
            const detail =
              typeof body === "object" &&
              body !== null &&
              "error" in body &&
              typeof body.error === "string"
                ? body.error
                : `Chat request failed (${response.status})`;
            throw new Error(detail);
          }
          return response;
        },
      });
      for await (const chunk of stream.connect([message], undefined, abort.signal)) {
        if (chunk.type === "RUN_ERROR") throw new Error(chunk.message);
      }
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not send message");
      // A failed connection must not leave its persisted queued turn locked.
      if (appId.current) {
        await client
          .mutation(convexApi.platform.stopTurn, { appId: appId.current, turnId: messageId })
          .catch(() => undefined);
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        requestedTurn.current = undefined;
        setRequesting(false);
      }
    }
  }
  async function stop() {
    const turnId = active?.id ?? requestedTurn.current;
    if (!turnId) return;
    try {
      if (appId.current)
        await client.mutation(convexApi.platform.stopTurn, { appId: appId.current, turnId });
      controller.current?.abort();
      setRequesting(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stop generation");
    }
  }
  return (
    <AgentChatView
      props={props}
      prompt={prompt}
      setPrompt={setPrompt}
      messages={props.app?.conversation ?? []}
      loading={loading}
      error={error}
      submit={() => void submit()}
      stop={() => void stop()}
    />
  );
}

export function AgentChat(props: AgentChatProps) {
  return props.reactive ? <ConvexAgentChat {...props} /> : <LocalAgentChat {...props} />;
}

function AgentChatView({
  props,
  prompt,
  setPrompt,
  messages,
  loading,
  error,
  submit,
  stop,
  stoppedTurn,
}: {
  props: AgentChatProps;
  prompt: string;
  setPrompt: (text: string) => void;
  messages: UIMessage[];
  loading: boolean;
  error?: string;
  submit: () => void;
  stop: () => void;
  stoppedTurn?: string;
}) {
  const results = new Map<string, Extract<Part, { type: "tool-result" }>>();
  for (const message of messages)
    for (const part of message.parts)
      if (part.type === "tool-result") results.set(part.toolCallId, part);
  const turns = conversationTurns(messages);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4" aria-label="Conversation">
      <div className="min-h-40 min-w-0 flex-1 md:min-h-0">
        {messages.length ? (
          <MessageScrollerProvider autoScroll>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent>
                  {turns.map((turn, index) => (
                    <MessageScrollerItem key={turn.user.id} messageId={turn.user.id} scrollAnchor>
                      <ConversationTurn
                        turn={turn}
                        active={
                          index === turns.length - 1 &&
                          (loading ||
                            (props.reactive === true &&
                              props.app?.agentTurn?.id === turn.user.id &&
                              ["queued", "running"].includes(props.app.agentTurn.status)))
                        }
                        timing={props.app?.turns?.find((run) => run.id === turn.user.id)}
                        results={results}
                        stopped={turn.user.id === stoppedTurn}
                      />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyTitle>
                {props.app ? "Start a conversation" : "What would you like to build?"}
              </EmptyTitle>
            </EmptyHeader>
            {!props.app && (
              <EmptyContent>
                {protocols.map((protocol) => (
                  <Button
                    key={protocol.id}
                    variant="outline"
                    disabled={props.disabled || loading}
                    onClick={() => props.onExample({ ...protocol.defaultSpec })}
                  >
                    {protocol.name}
                  </Button>
                ))}
              </EmptyContent>
            )}
          </Empty>
        )}
      </div>
      {!props.connected && (
        <Alert>
          <AlertTitle>Connect a model to chat</AlertTitle>
          <AlertDescription>Add a server model API key in Connections.</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not finish this turn</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel htmlFor="agent-message" className="sr-only">
          Message the AI
        </FieldLabel>
        <InputGroup>
          <InputGroupTextarea
            id="agent-message"
            className="min-h-24 max-h-40 overflow-y-auto"
            value={prompt}
            disabled={props.disabled || !props.connected}
            placeholder="Ask anything or describe a change…"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton size="icon-sm" aria-label="Import source" onClick={props.onImport}>
              <Upload />
            </InputGroupButton>
            <span className="min-w-0 truncate text-xs">{props.modelName}</span>
            {loading && (
              <InputGroupButton
                className="ml-auto"
                size="icon-sm"
                variant="destructive"
                aria-label="Stop generation"
                onClick={stop}
              >
                <Square />
              </InputGroupButton>
            )}
            {(!loading || !!prompt.trim()) && (
              <InputGroupButton
                className={cn(!loading && "ml-auto")}
                size="icon-sm"
                variant="default"
                aria-label="Send message"
                aria-disabled={!prompt.trim() || props.disabled || !props.connected}
                onClick={submit}
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </div>
  );
}

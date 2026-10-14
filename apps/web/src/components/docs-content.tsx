import { Button, buttonVariants } from "@web-starter/ui/components/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@web-starter/ui/components/table";
import { BookOpen, Download } from "lucide-react";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Heading } from "fumadocs-ui/components/heading";
import { protocols, capabilityContracts } from "../lib/contracts";
import { download } from "../lib/client";
import { protocolInstructions, sampleBundle } from "../lib/samples";

export function OverviewContent() {
  return (
    <>
      <p>
        Use these protocols and APIs in any coding tool. Import the completed source into Chengdu80,
        pass the release checks, and run it.
      </p>
      <div className="not-prose flex flex-wrap gap-2">
        <a href="/api/docs" className={buttonVariants({ variant: "outline" })}>
          <BookOpen data-icon="inline-start" />
          Machine-readable contract
        </a>
        <Button
          variant="outline"
          onClick={() =>
            download(
              "portfolio-example.bundle.json",
              JSON.stringify(sampleBundle(protocols[0].defaultSpec), null, 2),
            )
          }
        >
          <Download data-icon="inline-start" />
          Download working source example
        </Button>
      </div>
      <Heading as="h2" id="getting-started">
        Getting started
      </Heading>
      <ol>
        <li>Describe the app in a new conversation.</li>
        <li>Build an example, generate source with the model, or import a compatible bundle.</li>
        <li>Verification runs automatically before the app becomes active.</li>
        <li>Continue the conversation to change the app.</li>
      </ol>
      <Heading as="h2" id="reference">
        Reference
      </Heading>
      <ul>
        <li>
          <a href="/docs/source">Source format</a>
        </li>
        <li>
          <a href="/docs/sdk">Browser SDK</a>
        </li>
        <li>
          <a href="/docs/capabilities">Capabilities</a>
        </li>
        <li>
          <a href="/docs/protocols">Protocols</a>
        </li>
        <li>
          <a href="/docs/verification">Release checks</a>
        </li>
        <li>
          <a href="/docs/privacy">Privacy and updates</a>
        </li>
      </ul>
    </>
  );
}

export function SourceContent() {
  return (
    <>
      <p>
        Upload a JSON bundle with <code>manifest</code> and <code>files</code>. The application
        format contains a complete TanStack Start project with React, TypeScript and shadcn Nova.
        The starter includes its actual package manifest, Vite configuration, router, routes, UI
        components and typed platform SDK. The agent edits the project files and runs its normal
        check and build commands in an isolated workspace.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Contract</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="whitespace-normal">src/App.tsx</TableCell>
            <TableCell className="whitespace-normal">
              The starter's application component. Its index route renders this component;
              additional routes can render their own components.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">src/routes/**/*.tsx</TableCell>
            <TableCell className="whitespace-normal">
              TanStack file routes, loaders and server functions. __root.tsx owns the document,
              metadata and stylesheet links.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">src/styles.css</TableCell>
            <TableCell className="whitespace-normal">
              Optional app styles alongside generated Tailwind utilities and the supplied Nova
              theme. External resources are unavailable.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">src/components/ and src/lib/</TableCell>
            <TableCell className="whitespace-normal">
              Actual shadcn components, reusable capability components, app-specific modules and the
              typed cd80 SDK.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">
              package.json, vite.config.ts, tsconfig.json
            </TableCell>
            <TableCell className="whitespace-normal">
              The real workspace package scripts, dependencies and framework configuration. These
              files are visible in Code.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p>
        Bundle metadata stores the schema version, name, protocol and declared permissions. It is
        not a workspace source file. The agent changes permissions with the set_permissions tool.
      </p>
      <CodeBlock>
        <Pre>
          <code>
            {JSON.stringify(
              {
                schemaVersion: 3,
                name: "My portfolio app",
                protocol: "portfolio",
                permissions: [
                  "finance.calculate",
                  "storage.read",
                  "storage.write",
                  "market.prices",
                  "ai.explain",
                ],
              },
              null,
              2,
            )}
          </code>
        </Pre>
      </CodeBlock>
      <p>
        Import stock shadcn primitives from <code>@/components/ui/*</code>, reusable capability
        components from <code>@/components/capabilities</code>, and the typed SDK from
        <code>@/lib/cd80</code>. Generated server code runs in an isolated process without platform
        credentials or outbound networking. The preview serves the actual framework document and
        modules; it is not a compiled JavaScript string embedded in the builder. Imported updates
        retain the existing protocol and app data. Choose New chat to create a separate app.
      </p>
    </>
  );
}
export function SdkContent() {
  return (
    <>
      <p>
        Import typed capabilities from <code>@/lib/cd80</code>. The host provides an isolated
        message bridge; applications receive no model, database or provider credentials.
      </p>
      <CodeBlock>
        <Pre>
          <code>{`import { cd80, portfolioInputSchema } from '@/lib/cd80';

const inputs = await cd80.storage.read('inputs', portfolioInputSchema);
if (inputs) {
  const result = await cd80.finance.portfolio(inputs);
  console.log(result.totalValue);
}
await cd80.storage.write('note', 'Saved by the active app');`}</code>
        </Pre>
      </CodeBlock>
      <p>
        Import stock shadcn primitives from <code>@/components/ui/*</code>.
        <code>@/components/capabilities</code> supplies MetricCard, DataTable, PluginPanel and
        AIExplanationPanel. The starter's TanStack router provides TanStack Query; its root route
        renders the document and reports readiness after hydration.
      </p>
      <p>
        Calls return a Promise and reject on missing permissions, invalid data or unavailable
        services. Unknown storage and plugin data becomes typed only after validation with the
        caller's schema. The application can inspect the actual SDK and component source alongside
        its routes, package manifest and configuration in Code.
      </p>
    </>
  );
}
export function CapabilitiesContent() {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Capability</TableHead>
            <TableHead>Request</TableHead>
            <TableHead>Response</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(capabilityContracts).map(([name, contract]) => (
            <TableRow key={name}>
              <TableCell className="whitespace-normal">{name}</TableCell>
              <TableCell className="whitespace-normal">{contract.input}</TableCell>
              <TableCell className="whitespace-normal">{contract.output}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p>
        The key <code>inputs</code> initially contains the selected protocol's default input object.
        Storage keys contain 1–50 letters, digits, underscores, or hyphens. Shared data is limited
        to 150 KB. Calculation inputs and responses have size limits. No direct network access is
        allowed from app code.
      </p>
      <p>
        Read <code>_provenance</code> for the saved input dataset's origin. Keys beginning with an
        underscore are reserved and cannot be written by app code. Editing inputs changes their
        provenance to user-entered data. AI explanations use calculations recomputed on the server
        from the saved inputs.
      </p>
      <p>
        Finance providers are adapters to this normalized contract. Tushare prices are unadjusted
        daily closes in CNY. Missing fundamentals remain missing. Fixture data is invented and
        clearly labelled. The Alpha Vantage public demo is a narrow platform connection test. In
        local mode, Strategy apps can load its fixed Shanghai stock history from Connections. It is
        not a production feed available to generated apps.
      </p>
    </>
  );
}
export function ProtocolsContent() {
  return (
    <>
      <p>
        The builder chooses its own UI and implementation under the confirmed specification and
        protocol. This explanatory plan does not execute a workflow graph.
      </p>
      {protocols.map((p) => (
        <div key={p.id} className="flex flex-col gap-4">
          <Heading as="h2" id={p.id}>
            {p.name}
          </Heading>
          <ul>
            {p.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <Heading as="h3" id={`${p.id}-fixture`}>
            Independent verification fixture
          </Heading>
          <CodeBlock>
            <Pre>
              <code>{JSON.stringify(p.fixture, null, 2)}</code>
            </Pre>
          </CodeBlock>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(`${p.id}-protocol.txt`, protocolInstructions(p.defaultSpec), "text/plain")
            }
          >
            Download builder instructions
          </Button>
        </div>
      ))}
    </>
  );
}
export function VerificationContent() {
  return (
    <>
      <p>
        Every release runs the project's normal type checks and TanStack Start build in an isolated
        workspace. Generated server code runs with an isolated filesystem and network, without
        platform secrets. Source checks reject unsupported project files and embedded credentials.
        Independent fixtures validate fixed financial capabilities. Failed checks leave the active
        release and app data in place.
      </p>
      <p>
        These tests validate the published protocol contract. They do not certify every additional
        custom calculation. Inspect custom logic and the rendered app. Failed checks block
        activation. The stored SHA-256 binds verification to the exact source bundle.
      </p>
    </>
  );
}
export function PrivacyContent() {
  return (
    <>
      <p>
        Login is deferred for the prototype. Hosted demo visitors share one workspace. In future
        account mode, apps are private to the owning account. All users allowed to access an app
        share its app data. Team membership and public publishing are deferred. Local mode is a
        labelled single-owner workspace bound to this computer; it is not hosted authentication.
      </p>
      <p>
        A follow-up request or source import automatically activates after verification passes,
        retaining shared app data. Failed changes leave the working version in place.
        Protocol-changing imports require a new app.
      </p>
    </>
  );
}

export function ConversationContent() {
  return (
    <>
      <p>
        The conversation agent streams real model replies and tool activity through TanStack AI.
        Each chat has durable history and a title generated by the configured model. You can discuss
        an idea without building, then ask the agent to create or change the site in the same
        conversation.
      </p>
      <p>
        The agent can list, read, write and edit workspace files, run a bounded virtual Bash shell,
        inspect app data and reported browser errors, discover registered plugins, and deploy
        verified changes. Stop interrupts the current turn. File edits are staged; failed checks
        leave the working site and data intact.
      </p>
      <p>
        Workspaces contain real TanStack Start project files. The agent works on routes, components,
        SDK calls and project configuration. Checks and builds run in an isolated process; browser
        previews serve the framework through a scoped preview session. Successful releases activate
        automatically.
      </p>
    </>
  );
}

export function PluginsContent() {
  return (
    <>
      <p>
        Register a plugin in Connections by providing an OpenAPI 3 JSON or YAML document, or a
        public HTTPS URL to one. The system owns the registry. The AI discovers the registered
        operations and their parameter schemas; it does not create or register plugins.
      </p>
      <p>
        For API-key or bearer authentication, configure a server environment variable beginning with
        CD80_PLUGIN_ and enter its name in the registration form. Credential values stay on the
        server and are excluded from plugin metadata, tool results, and generated source.
      </p>
      <p>
        The AI enables the selected plugin for an app and declares the plugin.call permission
        through the set_permissions tool. The generated app calls an exact registered operation
        through the browser SDK. The server checks ownership, permissions and parameters, attaches
        authentication, and returns JSON.
      </p>
      <CodeBlock>
        <Pre>
          <code>{`import { cd80 } from '@/lib/cd80';
const weather = await cd80.plugins.call({
  pluginId: "registered-plugin-id",
  operationId: "getWeather",
  parameters: { city: "London" }
});`}</code>
        </Pre>
      </CodeBlock>
      <p>
        Parameters use their documented names; a JSON request body goes under body. Public HTTPS
        endpoints and local schema references are supported. OAuth, Swagger 2, external references
        and combined schemas are currently unsupported and produce an explicit error.
      </p>
      <p>
        The server blocks private network destinations and redirects, limits request time and
        response size, and resolves credentials at runtime. A plugin can only execute its registered
        operations; it is not an arbitrary HTTP proxy.
      </p>
    </>
  );
}

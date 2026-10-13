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
              "portfolio-example.cd80.json",
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
        Upload a JSON bundle with <code>manifest</code> and <code>files</code>. Version 2 supports
        React and TypeScript with the supplied shadcn Nova starter. Version 1 remains compatible
        with existing plain JavaScript apps. The platform supplies pinned dependencies and build
        configuration; apps cannot install packages or run arbitrary server frameworks.
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
              Version 2 React entry component, exported as default. Compose supplied shadcn
              components and platform capabilities in ordinary TSX.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">src/components/**/*.tsx or .ts</TableCell>
            <TableCell className="whitespace-normal">
              Optional app-specific components and helpers. Relative source imports are supported.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">cd80.json</TableCell>
            <TableCell className="whitespace-normal">
              Manifest with schemaVersion, name, protocol, permissions
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">index.html</TableCell>
            <TableCell className="whitespace-normal">
              Safe body fragment. Version 2 supplies the React root. No scripts, executable HTML
              handlers, embedded frames or external resources.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">app.js</TableCell>
            <TableCell className="whitespace-normal">
              Version 1 browser JavaScript, with top-level await but no imports. Version 2 retains
              this compatibility file and executes the compiled React entry instead.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">calculations.js</TableCell>
            <TableCell className="whitespace-normal">
              Self-contained ES module exporting analyze(input). Runs in a separate Worker.
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">style.css</TableCell>
            <TableCell className="whitespace-normal">
              Additional app styling. Version 2 includes generated Tailwind utilities and the
              supplied Nova theme. External resources remain unavailable.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <CodeBlock>
        <Pre>
          <code>
            {JSON.stringify(
              {
                schemaVersion: 2,
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
        Version 2 imports React, stock shadcn primitives from <code>@/components/ui/*</code>,
        reusable capability components from <code>@cd80/components</code>, and typed platform
        capabilities from <code>@cd80/sdk</code>. Build dependencies and the entry point are
        platform-owned, not editable package configuration. Bundles are limited to 44 source files
        and 200 KB of source; the upload limit is 250 KB. Imported updates must retain the app's
        existing protocol. Import source while an app is selected to apply an update; choose New
        chat first to create a separate app.
      </p>
    </>
  );
}
export function SdkContent() {
  return (
    <>
      <p>
        The host installs <code>window.cd80</code> before your app runs. Its calls use a validated
        message bridge. Applications receive no model, database, or provider credentials.
      </p>
      <CodeBlock>
        <Pre>
          <code>{`const inputs = await cd80.call("storage.read", { key: "inputs" });
const result = await cd80.call("finance.calculate", inputs);
document.getElementById("result").textContent = JSON.stringify(result);
cd80.ready();

// Active verified apps may save shared inputs. Failed builds cannot write.
await cd80.call("storage.write", { key: "inputs", value: inputs });`}</code>
        </Pre>
      </CodeBlock>
      <p>
        React apps import <code>cd80</code> from <code>@cd80/sdk</code> for the same capabilities
        with typed requests. Import UI primitives from <code>@/components/ui/*</code>; they are real
        shadcn components bundled with React. <code>@cd80/components</code> supplies MetricCard,
        DataTable, PluginPanel and AIExplanationPanel. The fixed shell mounts the default export
        from <code>src/App.tsx</code> and reports readiness.
      </p>
      <p>
        Calls return a Promise and reject on missing permissions, invalid data, or unavailable
        services. Call <code>cd80.ready()</code> after rendering. Use DOM textContent or escape user
        data before inserting HTML.
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
        Version 2 first type-checks and bundles TSX against the fixed React/shadcn starter in a
        bounded build worker. Only approved imports and workspace source paths can resolve. The
        compiled browser bundle runs under the same opaque iframe, CSP and capability bridge as
        version 1, without direct networking or credentials. Every build and source import checks
        its manifest, source syntax, required permissions, potential embedded credentials, HTML
        isolation, exported calculation function, protocol numerical fixture, boundary values, and
        invalid inputs. Calculation checks execute in Miniflare/workerd in local and self-hosted
        modes, without provider secrets or outbound network.
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
        New workspaces use the React/TSX starter with editable app components and supplied shadcn
        primitives. Existing version 1 apps keep their plain JavaScript source contract. The shell
        is isolated from host files, secrets and networking, and is not a package-install
        environment. Deployment type-checks version 2 source, builds the fixed starter and runs
        protocol and isolation checks before automatically activating the site.
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
        The AI enables the selected plugin for an app and declares the plugin.call permission in
        cd80.json. The generated app calls an exact registered operation through the browser SDK.
        The server checks ownership, permissions and parameters, attaches authentication, and
        returns JSON.
      </p>
      <CodeBlock>
        <Pre>
          <code>{`const weather = await cd80.call("plugin.call", {
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

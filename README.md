# BusinessWorks import flows for TIBCO Developer Hub

## Prerequisites: git provider access in `app-config`

The flow reads files from your repository (project files, Swagger, docs sources), so DevHub needs an
`integrations` entry for **every git host you use**. Without one, reads fail (401/404 on private repos) or hit
anonymous rate limits (GitHub allows 60 requests/hour per IP, which a single import can exceed).
Put these in `app-config.portable.yaml` (or your deployment's app-config); `${VAR}` values come from
environment variables of the process running DevHub.

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}            # fine-grained PAT: Contents + Metadata read on the repos
    # GitHub Enterprise Server: host, apiBaseUrl (https://HOST/api/v3), rawBaseUrl (https://HOST/raw)
    # Org-wide: use a GitHub App (apps: appId, clientId, clientSecret, privateKey, webhookSecret)
  gitlab:
    - host: gitlab.com
      token: ${GITLAB_TOKEN}            # read_api + read_repository
    - host: gitlab.example.com          # self-hosted
      token: ${GITLAB_SELFHOSTED_TOKEN}
      apiBaseUrl: https://gitlab.example.com/api/v4
      baseUrl: https://gitlab.example.com
  bitbucketCloud:                       # host is always bitbucket.org
    - username: ${BITBUCKET_USERNAME}
      appPassword: ${BITBUCKET_APP_PASSWORD}
    # Atlassian is replacing app passwords with API tokens; newer Backstage versions accept a
    # token with the Atlassian email as username. Check the docs for your version.
  bitbucketServer:                      # Server / Data Center
    - host: bitbucket.example.com
      apiBaseUrl: https://bitbucket.example.com/rest/api/1.0
      token: ${BITBUCKET_SERVER_TOKEN}
  gitea:                                # Gitea and Forgejo both use this provider
    - host: git.example.com
      username: ${GITEA_USERNAME}
      password: ${GITEA_TOKEN}          # an access token works as the password
```

Also:

- Add each host you want to import from to `allowedHosts` in the flow's `RepoUrlPicker` (the default list
  contains an example host to replace).
- `backend.reading.allow` is not needed for hosts that have an `integrations` entry.
- Check the exact options for your Backstage version in the
  [integrations documentation](https://backstage.io/docs/integrations/).
- For TechDocs generated locally, `mkdocs` and `mkdocs-techdocs-core` must be installed on the host running DevHub.

## Deep import flow (`import-flow-bw-deep.yaml`)

Point it at a git repository that contains a TIBCO BusinessWorks (BW6 / BWCE) project and it builds the
catalog entries from what is in the project, commits them to the repository and registers them:

| Generated from | Entity / content |
|---|---|
| `.project`, `META-INF/MANIFEST.MF` (application and module) | **Component**: name, application and BW version, edition (BW6 / BWCE), tags from the palettes used, process count |
| `Service Descriptors/*.json` (OpenAPI / Swagger) | **API** entities whose definition is read live from the repository, linked to the Component (`providesApis`) |
| `Resources/**/*Resource` shared resources | **Resource** per JMS connection, HTTP connector, JDBC connection and so on |
| `META-INF/default.substvar` (application profile over module defaults) | **Resource** for the EMS broker, the database and each queue/topic variable, with `dependsOn` relations |
| `Processes/**/*.bwp` | per-process inventory (trigger, activity types, calls to other processes, fault handlers), a **call tree** from each entry point, and "called by" |
| links between activities in the `.bwp` files | **flow** of each process: an SVG diagram and a From / To table (see below) |
| messaging activities in the processes (JMS, Kafka, FTL, Rendezvous, MQ, AMQP, MQTT) | **messaging map**: each queue/topic Resource says which processes produce to it and which consume from it; a destination named only inside a process gets its own Resource |
| REST bindings in `module.bwm` and the processes | which process implements each REST operation (on the API page) |
| other palette activities (JDBC, HTTP, SOAP, files ...) | "systems the processes talk to": process, activity, technology, connection resource, URL/SQL and literal host/URI values typed into the mapping |
| REST and SOAP reference bindings, HTTP client activities | **API** entities for the services the application calls, linked with `consumesApis` (see *Outbound APIs*) |
| `Service Descriptors/*.wsdl` | **API** (type `wsdl`), provided or consumed |
| input mappings (`tibex:inputBinding` XSLT) | a **Mappings** page: system-to-system data flow and a per-activity field table |
| `Schemas/*.xsd` | schema page: top-level elements and types per file |
| configuration and process structure | **findings** page: hardcoded private IPs, plain `http://` URLs, secret-like variables with plain values, placeholder `Sleep` activities, processes without fault handlers, unreferenced processes, no logging, no tests (secret values are never read into the page) |
| `.ear` files and `Tests/` | release artefacts and test-file counts |
| the whole project | **TechDocs** (overview, processes, messaging, mappings, API, resources, schemas, findings) |
| form | owner, system, domain, lifecycle (a BW project cannot tell you these); optional System and Domain entities |

Everything is written under one folder (default `devhub/`) in the repository. Files you maintain by hand,
including an existing `catalog-info.yaml`, are not touched. Secrets are never copied: variables whose name
looks like a secret, obfuscated passwords (`#!...`) and `%%placeholders%%` are skipped.

### Supported git providers

Pick the provider in the form (self-hosted servers cannot be told apart by host name):

| Provider | Clone URL | File / registration URL |
|---|---|---|
| GitHub (cloud, Enterprise Server) | `https://host/owner/repo` | `.../blob/<branch>/<path>` |
| GitLab (gitlab.com, self-hosted, nested groups) | `https://host/group/sub/repo` | `.../-/blob/<branch>/<path>` |
| Bitbucket Cloud | `https://bitbucket.org/workspace/repo` | `.../src/<branch>/<path>` |
| Bitbucket Server / Data Center | `https://host/scm/PROJECT/repo.git` | `.../projects/PROJECT/repos/repo/browse/<path>?at=refs/heads/<branch>` |
| Gitea / Forgejo | `https://host/owner/repo` | `.../src/branch/<branch>/<path>` |

Cloning and pushing use `tibco:git:clone` / `tibco:git:push`, which take their credentials from the
`integrations:` section of the Developer Hub app-config for the matching host, so each host needs an entry
there (and the token must be allowed to read and write the repository):

```yaml
integrations:
  github:    [{ host: github.com, token: ${GITHUB_TOKEN} }]
  gitlab:    [{ host: gitlab.example.com, token: ${GITLAB_TOKEN} }]          # also gitlab.com
  bitbucketCloud:  [{ username: ${BB_USER}, appPassword: ${BB_APP_PASSWORD} }]
  bitbucketServer: [{ host: bitbucket.example.com, token: ${BBS_TOKEN} }]
  gitea:     [{ host: git.example.com, baseUrl: https://git.example.com, username: ${GITEA_USER}, password: ${GITEA_TOKEN} }]
```

Add every host you want in the picker to `allowedHosts` in the template (top of `parameters`). The
template ships with github.com, gitlab.com, bitbucket.org and the author's own Forgejo host
(`git.vewins.co.uk`), which you should replace with yours.

### Using it

1. Register the template: add `templates.yaml`, or the template file, to `catalog.locations` in your app-config,
   for example `- type: url` / `target: https://github.com/<owner>/<this-repo>/blob/main/templates.yaml`.
2. Open **Import Flow** (`/import-flow`), choose the provider, repository, branch and project folder. The branch is a
   drop-down of common names (`main`, `master`, `develop`, `development`, `trunk`); for any other branch, type its exact
   name in *Other branch*, which overrides the list. Edit the `enum` under `branch` to suit your naming.
3. Enter owner, system and lifecycle, then run it. The Component, APIs and Resources appear in the catalog.

### Process flow diagrams

The processes page has a **Flow of &lt;process&gt;** section for every process: a diagram plus a From / To table.
The diagram is an SVG drawn by the import template itself (a simple left-to-right layered layout) and written into
the page as inline markup. **Nothing needs installing on the TechDocs host** - no Graphviz, no mkdocs plugin, no
JavaScript - so it works on the standard Developer Hub image.

* Nodes are coloured by activity type: start green, end orange, sub-process call blue, messaging yellow,
  HTTP/SOAP/REST purple, database green, fault handling red. The activity type is printed under the name.
* Transitions that carry a condition are labelled with it (hover for the full text); the "otherwise" path is labelled;
  error paths are red and dashed.
* Group bodies (for example an *Iterate* group) and fault handlers are drawn as dashed boxes under the main flow,
  labelled with the group name.

It is on by default; untick **Draw process flow diagrams in the documentation** (`processDiagrams`) to get the table only.
Wide processes scroll sideways. The layout is deliberately basic: an edge that skips a column can pass behind a box,
and groups are drawn beneath the main flow rather than nested inside the group activity. Boxes are matched to group
names by order, and a fault handler is recognised only because its links are disconnected from the main flow.

The diagram is drawn from the BPEL links in the `.bwp` files (`<sources>` / `<targets>`), so it shows the logical flow
of the process, not the canvas layout you see in BusinessWorks Studio.

### Supported technologies (the activity registry)

The importer recognises activities by their type prefix, in a table at the top of `src/_analysis.njk`. Each row gives
a technology label, a category (messaging, http, soap, db, file, other), the attribute names that hold the destination
and, for messaging, a hint for finding the broker address among the configuration variables.

| Technology | Prefix | What is produced |
|---|---|---|
| JMS | `bw.jms.` | queue/topic Resources, EMS broker Resource (shared modes name them by address) |
| Kafka, FTL, Rendezvous, MQ, AMQP, MQTT | `bw.kafka.` `bw.ftl.` `bw.rv.` `bw.mq.` `bw.amqp.` `bw.mqtt.` | a destination Resource per topic/endpoint/subject with producers and consumers, plus a cluster Resource found from a configuration variable whose name contains the hint (`bootstrap`, `kafka`, `ftl`, `realm` ...) |
| HTTP, REST, SOAP | `bw.http.` `bw.restjson.rest` `bw.soap.` `bw.ws.` and reference bindings | listed under systems; outbound calls become consumed APIs |
| JDBC, MongoDB | `bw.jdbc.` `bw.mongodb.` | listed under systems; tables read from the SQL; the database Resource is shared by connection URL in the shared modes |
| File, SFTP, FTP, mail, TCP, Salesforce, SAP | `bw.file.` `bw.sftp.` ... | listed under systems |

To support another plugin, add a row. An activity that matches no row is still listed under its type name.

**Verified against real projects:** JMS, JDBC, HTTP client, REST reference binding and SOAP reference binding
(BW 2.10 `bwcf` project plus the TIBCO `bw-samples`, `bw-sample-for-soap-currency-converter` repositories).
**Not verified:** Kafka, FTL, Rendezvous, MQ, AMQP, MQTT. No real project using them was available, so those rows
assume the plugins follow the same `bw.<plugin>.<activity>` naming and carry the destination in an attribute named in the
row. They were tested only against copies of a JMS project edited to look like Kafka and FTL. If a destination is not
picked up, check the attribute name in your `.bwp` and adjust the row's `attrs`.

### Mappings

The **Mappings** page is built from each activity's input mapping, which BusinessWorks stores as an XSLT stylesheet.

* **Data flow between systems**: mappings that feed an activity talking to another system, and the reply of each
  process, with the source (process input, an earlier activity, a module property) and the target field.
* **Mappings per process**: for each activity, target field, the source expression exactly as written, and the
  activity or process input it takes data from. A condition such as `for each ...` is shown beside the expression.

Expressions are not interpreted: loops, conditions and custom functions are shown as written. Only `$variable`
references to declared process variables count as sources, so XSLT loop variables are ignored. A mapping assembled
across several steps appears as separate rows rather than one end-to-end lineage. The system table stops at 250 rows
and each activity at 60.

### Outbound APIs

A REST or SOAP reference binding, and an HTTP client activity, becomes an **API** entity that the Component lists under
`consumesApis`, so the topology shows application, API. The interface is not part of the project, so the entity holds a
placeholder definition with the operations, methods, path and any literal host or URI found in the mapping. Resource
and API naming follows `infraMode` (`per-app`: named after the application; shared modes: named after the endpoint,
defined once). An HTTP client API is named after the literal URI in the mapping when there is one, otherwise after
the connection.

### Shared broker and queue entities

By default every application gets its own EMS broker and queue entities, named after the application
(`orderprocessing-ems-broker`, `orderprocessing-queue-orders`). If several applications use the same broker, choose a
shared mode under **Message broker and queues** (`infraMode`) so they point at the same entities and the topology
shows which applications use each queue:

| Mode | Behaviour |
|---|---|
| `per-app` (default) | Entities named after the application |
| `shared-define` | The broker is named after its address (`ems-<host>-<port>`) and each queue after the broker and destination; this import **defines** them |
| `shared-reference` | Same shared names, but this import only **references** them |

A catalog entity can only be defined once, so use `shared-define` for the first application on a broker and
`shared-reference` for every other one (a reference to an entity that does not exist yet shows as unresolved until
the defining import is registered). A broker on `localhost` or `127.x` always falls back to per-app names. Entity
names are limited to 63 characters; longer queue names are truncated. Database Resources are still per application.

The generated entities also carry a `tibco.developer.hub/topology` theme (Component blue, API purple, broker orange,
queue yellow, database green, shared resource light green) used by the Integration Topology view.

### Cloud and Kubernetes deployments

The flow is stateless: it needs only the scaffolder actions that ship with Developer Hub, no local tools and
no persistent storage. When Developer Hub runs in the cloud, supply the git tokens through your secret store as
the `integrations:` environment variables, and allow outbound HTTPS from the pod to the git hosts.

### Documentation (TechDocs)

The Component's `backstage.io/techdocs-ref` is an absolute `url:` pointing at the generated folder, so the docs are
built from the generated `mkdocs.yaml` and `docs/` and never from any `docs/` or `mkdocs.yml` already in the
repository. (`dir:.` is not used: TechDocs resolves it against `backstage.io/source-location`, the BW project
folder.) The Developer Hub host needs `mkdocs` with `mkdocs-techdocs-core` when `techdocs.generator.runIn` is
`local`, or Docker when it is `docker`.

### How the analysis works, and how to change it

The flow reads each process once with `tibco:extract-parameters` (XPath over the `.bwp` XML) inside a step with
`each:`. Backstage collects the outputs of an `each` step into one array entry per file, in file order, which is how
results stay attached to the right process. The analysis itself is Nunjucks in `src/_analysis.njk`. `fetch:template`
renders each file on its own and cannot include other files, so `tools/build-skeleton.mjs` inlines that analysis into
every page and writes `entity-skeletons-bw-deep/`. Edit `src/`, then run `node tools/build-skeleton.mjs` (the built
folder is what the flow uses and is committed).

### Limitations

* The process analysis is verified against JMS, JDBC, HTTP client, REST and SOAP reference projects. Kafka, FTL and the
  other messaging rows in the activity registry are not (see *Supported technologies*).
* Findings are heuristics, not a code review; some will be intentional.
* The call tree follows *Call Process* activities only (not sub-process inline groups or dynamic calls).
* Process diagrams show the link graph, not the Studio canvas, and use a basic layout.
* The branch list is static: Backstage's form has no built-in field that lists a repository's real branches
  (that needs a custom scaffolder field extension in the Developer Hub build), hence the *Other branch* override.
* The first application and first module found are imported. Use the *Application name* field to choose
  another one in a repository that holds several.
* Database Resources are derived from `jdbc:` configuration variables; a database named only inside an activity is
  listed under "systems the processes talk to" but does not get its own Resource. Tables come from the SQL text of the
  activities, not from the database.
* Outbound API entities link only to the consuming application; the importer cannot tell which application provides a
  called endpoint.
* Bitbucket Server instances served under a context path (`https://host/bitbucket/...`) are not handled yet.
* Generated descriptions are factual, not curated: edit the generated files to add team names, links and prose.

### Testing without Developer Hub

`tools/simulate.mjs` replays the template's steps against a local copy of a BusinessWorks project, using the
same libraries as the TIBCO extraction action, and validates every generated entity with Backstage's own
catalog-model rules:

```
cd tools && npm install
node simulate.mjs /path/to/bw-project params.example.json
```

## Thin flow (`import-flow-bw6-forgejo.yaml`)

An adaptation of [TIBCO's own BW6 import flow](https://github.com/TIBCOSoftware/tibco-developer-hub/blob/main/tibco-examples/advanced-import-flows/import-flow-bw6.yaml)
for Forgejo/Gitea hosts (host list, URL forms and the skeleton annotation changed; see `NOTICE`). It only creates a name, description and dependencies; use the deep flow above for more.

## Re-running the flow

The flow overwrites its generated files on every run, so re-running refreshes them. Registration is strict: if
the location is already registered the final step fails with `409 Conflict`. Unregister first (open an entity,
**⋮ > Unregister entity > Unregister Location**; do not use *Delete Entity*, which leaves the location behind).

## Status

Tested offline against a BW6 project for all five providers with `tools/simulate.mjs`, and end to end against
Gitea/Forgejo in a local Developer Hub. GitHub, GitLab and Bitbucket are covered by the simulator only; reports
and pull requests are welcome.

## Licence and attribution

Apache License 2.0, see `LICENSE`. `import-flow-bw6-forgejo.yaml` is adapted from TIBCO's Apache-2.0 example,
see `NOTICE`. This is an independent community project, not made, endorsed or supported by TIBCO / Cloud
Software Group. TIBCO, BusinessWorks and BWCE are trademarks of Cloud Software Group, Inc.

## MFT import flow (`import-flow-mft.yaml`)

Imports a TIBCO MFT estate (Command Center, Internet Server, Platform Server) into the catalog. Same clone → generate →
push → register pattern as the BusinessWorks flows, with two differences: the source is a **live Command Center**, and the
target repository can be **created or updated**.

1. **Command Center page**: URL, user and password (a scaffolder secret, never written anywhere), whether to include
   Internet Server definitions, the Internet Server host name (for the FTP / FTPS / SFTP listeners), HTTPS port, warning window.
2. **Repository page**: git provider (GitHub, GitLab, Bitbucket Cloud, Bitbucket Server / Data Center, Gitea / Forgejo; cloud or
   self-hosted), repository, branch, output folder, and **Use an existing repository (update it)** or **Create the repository**.
   Creating needs an API token (a secret used for the one call) and works for GitHub (user or organisation), GitLab (user or
   group) and Gitea / Forgejo (user or organisation); the repository is initialised with a README so the branch exists.
   It is not offered for Bitbucket, whose API cannot create an initialised repository: create it there, then choose *existing*.
3. The flow reads the REST API with `tibco:call-platform-api` (basic authentication), writes `catalog-info.yaml`, TechDocs pages
   and a raw `snapshot.json` of the API responses into the output folder, commits and pushes (`tibco:git:clone` / `tibco:git:push`,
   credentials from the Hub's `integrations:`), and registers the catalog file. Re-running regenerates the folder: entity names
   are `<instance>-<kind>-<id>`, so existing entities are updated and removed servers/transfers disappear.

| Generated from | Entity |
|---|---|
| the Command Center | **Component** `mft-command-center` (version, licence expiry, TechDocs) |
| Server definitions (Platform Server, FTP/FTPS, SFTP, HTTP, ...) | **Resource** `mft-server`; tags for protocol and security, `insecure-transport` when no TLS |
| Internet Server FTP / FTPS / SFTP / HTTPS listeners | **Resource** `mft-protocol-endpoint` |
| Internet Server partner users | **Resource** `mft-partner-user`, depends on the endpoints their allowed protocols permit |
| system keys and stored server certificates | **Resource** `certificate`, `mft/cert-expires`, `mft/cert-days-left`-style findings, tags `cert-expiring` / `cert-expired` |
| Platform Server transfers; Internet Server transfers (inbound `*LOCAL`, outbound to a partner) | **Component** `file-transfer`, depends on servers / endpoints / users; earliest certificate expiry on the transfer |
| everything | **TechDocs**: overview, findings (clear text, expiring certificates, licence), certificates, transfers |

Requirements and limits:

* The Hub backend must reach the Command Center and trust its TLS certificate (private CA: set `NODE_EXTRA_CA_CERTS` for the Hub
  process). If `scaffolder.tibcoCallPlatformApi.allowedHosts` is configured, add the Command Center host to it.
* "Today" for certificate status comes from the `Date` header of the Command Center response (templates have no clock).
* The Internet Server HTTPS certificate is only in the Tomcat keystore, so its expiry is not tracked (reported as a finding);
  nor are live TLS probes of partners done (an outbound partner whose served certificate differs from the pinned one is not detected).
* Not covered yet: other transfer families (scheduled jobs, AS2, OFTP2, JMS, PGP), audit / live status.
* The optional steps (version, licence, FTP and SFTP listener) use `continueOnError`.
* Create-repository calls were written from the providers' API documentation and have not been run against live servers.

Offline test with saved REST responses (`fixtures/mft-lab-rest/`, Command Center 8.7.1.8):
`cd tools && npm i && STRICT=1 FLOW=import-flow-mft.yaml MFT_FIXTURES=../fixtures/mft-lab-rest node simulate.mjs ../fixtures/empty params.mft.example.json ..`
(`MFT_DATE` overrides the response date). Sources are in `src-mft/`, built into `entity-skeletons-mft/` by
`node tools/build-skeleton.mjs mft`.

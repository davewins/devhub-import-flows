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
- **Optional, only for process diagrams: Graphviz.** The deep flow can draw a diagram of each process (see
  [Process flow diagrams](#process-flow-diagrams)). The diagrams are rendered when the TechDocs build runs, by the
  Graphviz `dot` program, so `dot` must be installed **on the machine (or inside the container) that runs
  `mkdocs`**. It is *not* part of the standard TIBCO Developer Hub image, which only ships `mkdocs` and
  `mkdocs-techdocs-core`. Leave the "Draw process flow diagrams" option off if you cannot install it.

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
| links between activities in the `.bwp` files | **flow** of each process: a From / To table, and optionally a Graphviz diagram (see below) |
| JMS activities in the processes | **messaging map**: each queue/topic Resource says which processes produce to it and which consume from it; a destination named only inside a process gets its own Resource |
| REST bindings in `module.bwm` and the processes | which process implements each REST operation (on the API page) |
| other palette activities (JDBC, HTTP, SOAP, files ...) | "systems the processes talk to": process, activity, connection resource and the URL/SQL attribute where one exists |
| `Schemas/*.xsd` | schema page: top-level elements and types per file |
| configuration and process structure | **findings** page: hardcoded private IPs, plain `http://` URLs, secret-like variables with plain values, placeholder `Sleep` activities, processes without fault handlers, unreferenced processes, no logging, no tests (secret values are never read into the page) |
| `.ear` files and `Tests/` | release artefacts and test-file counts |
| the whole project | **TechDocs** (overview, processes, messaging, API, resources, schemas, findings) |
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

The processes page has a **Flow of &lt;process&gt;** section for every process. The From / To table is always
generated. If you tick **Draw process flow diagrams in the documentation** (`processDiagrams`, off by default) the
page also gets a diagram, written as a fenced block:

````
```graphviz dot createorderprocess-flow.svg
digraph "CreateOrderProcess" { ... }
```
````

`mkdocs-techdocs-core` includes the `markdown-graphviz-inline` extension, which runs `dot -Tsvg` while the docs are
built and embeds the result as an inline image. Nothing is committed and nothing runs in the browser. Nodes are
coloured by activity type (start green, end orange, calls blue, logging grey, with the activity type under the name).

**Graphviz must be installed where `mkdocs` runs:**

| Where TechDocs is built | Install |
|---|---|
| Debian / Ubuntu / WSL host | `sudo apt install graphviz` |
| Alpine (the standard Developer Hub image is Alpine) | `apk add graphviz`, in a derived image or the Dockerfile |
| macOS | `brew install graphviz` |
| `techdocs.generator.runIn: docker` | put Graphviz in the docker image that runs `mkdocs`, not on the host |
| `techdocs.builder: external` (docs built in CI) | install it on the CI runner |

Check with `dot -V`. If the diagrams come out with cramped or overlapping text, install a font package as well
(for example `fonts-dejavu-core` on Debian or `ttf-dejavu` on Alpine); the Alpine and font notes have not been tested.

**What happens without it:** the docs build still succeeds, but in place of each diagram the page shows
`Error : [Errno 2] No such file or directory: 'dot'`, and the From / To table below it is unaffected. That is why the
option is off by default. Tick it only when your TechDocs host has Graphviz.

The diagram is drawn from the BPEL links in the `.bwp` files (`<sources>` / `<targets>`), so it shows the logical flow
of the process, not the canvas layout you see in BusinessWorks Studio. Link conditions and fault paths are not drawn,
and the activities inside a group appear in the same graph as the group, without a box around them.

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
no persistent storage (the optional process diagrams need Graphviz on the TechDocs host, see above). When Developer Hub runs in the cloud, supply the git tokens through your secret store as
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

* The process analysis is verified against JMS and REST projects. For other palettes (JDBC, HTTP client, SOAP, file,
  mail ...) the activity is listed with its connection resource and any `url`/`path`/`statement` attribute, but those
  attribute names have not been checked against a real project that uses them.
* Findings are heuristics, not a code review; some will be intentional.
* The call tree follows *Call Process* activities only (not sub-process inline groups or dynamic calls).
* Process diagrams show the link graph, not the Studio canvas, need Graphviz on the TechDocs host, and have been
  checked against one BW 2.10 (`bwcf`) project only.
* The branch list is static: Backstage's form has no built-in field that lists a repository's real branches
  (that needs a custom scaffolder field extension in the Developer Hub build), hence the *Other branch* override.
* The first application and first module found are imported. Use the *Application name* field to choose
  another one in a repository that holds several.
* Database Resources are still derived from `jdbc:` configuration variables; a database used only through a process
  activity is listed under "systems the processes talk to" but does not get its own Resource.
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

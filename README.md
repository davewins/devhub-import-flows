# BusinessWorks import flows for TIBCO Developer Hub

## Deep import flow (`import-flow-bw-deep.yaml`)

Point it at a git repository that contains a TIBCO BusinessWorks (BW6 / BWCE) project and it builds the
catalog entries from what is in the project, commits them to the repository and registers them:

| Generated from | Entity / content |
|---|---|
| `.project`, `META-INF/MANIFEST.MF` (application and module) | **Component**: name, application and BW version, edition (BW6 / BWCE), tags from the palettes used, process count |
| `Service Descriptors/*.json` (OpenAPI / Swagger) | **API** entities whose definition is read live from the repository, linked to the Component (`providesApis`) |
| `Resources/**/*Resource` shared resources | **Resource** per JMS connection, HTTP connector, JDBC connection and so on |
| `META-INF/default.substvar` (application profile over module defaults) | **Resource** for the EMS broker, the database and each queue/topic variable, with `dependsOn` relations |
| the whole project | **TechDocs** skeleton: overview, process list, API endpoints, resources and configuration variables |
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

### Limitations

* The branch list is static: Backstage's form has no built-in field that lists a repository's real branches
  (that needs a custom scaffolder field extension in the Developer Hub build), hence the *Other branch* override.
* The first application and first module found are imported. Use the *Application name* field to choose
  another one in a repository that holds several.
* Relations are derived from shared-resource files and configuration variables; the flow does not parse the
  `.bwp` process XML, so a database used only inside a process is not detected unless a `jdbc:` variable exists.
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

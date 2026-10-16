# Planning skill for the docs chat

Status: built (Plan mode, five tools, "Create plan page"). Tools run in Plan mode only.

## What you asked for

A planning skill in the docs chatbot that:

1. asks questions,
2. clarifies the answers,
3. writes a document with a checklist,
4. bases that document on the actual application.

## What the internet says (web search)

Searching for AI planning skills turned up many mirrored copies of one "brainstorming" skill, which matches your idea closely:

- Ask clarifying questions **one at a time**, preferring multiple-choice.
- Explore the project context first, then ask, then propose 2–3 approaches with trade-offs.
- Present the design for approval before anything gets built.
- Hand off to a "writing-plans" step that produces the detailed implementation plan.

Sources:

- <https://skillselion.com/skills/roin-orca/agent-skills/brainstorming>
- <https://skillselion.com/skills/pedronauck/devstack/brainstorming>
- <https://llmbase.ai/skills/unclecatvn/brainstorming/>

The search found nothing usable on spec-kit, and only a little on writing-plans, so the checklist format below is my own design, not copied from a source.

## Design for DevOne

- A **Plan** mode next to the normal **Ask** mode in the chat.
- In Plan mode the assistant:
  - reads the project's docs, and the code of the branch picked in the Code picker, before asking anything;
  - asks one question at a time, with short options when it can, at most about five;
  - when it has enough, or you say "write the plan", answers with the complete plan inside a `devone-plan` fence.
- The plan is Markdown with a goal, scope, approach, and a checklist (`- [ ]`) grouped into phases. Items name real files and docs from the project.
- A **Create plan page** button saves it as a new docs page in a "Plans" folder. The checklist items can then be ticked off in the page.
- Without a branch picked the plan is based on the docs only, and the assistant says so and suggests picking a branch.

## Tools the AI can call (Plan mode)

| Tool | What it does |
| --- | --- |
| `search_docs` | Finds passages in the project docs |
| `read_doc` | Reads one docs page by title |
| `list_branches` | Lists linked repositories and their branches |
| `list_files` | Lists a folder of a branch |
| `read_file` | Reads one file of a branch |

The server runs the tool loop (up to 6 rounds) and checks every call: the repository must be linked to the project and the branch must exist. If the model or provider rejects tool calls, the chat falls back to planning from the docs excerpts and the picked branch's code context, without tools. Tools used show as chips under the answer.

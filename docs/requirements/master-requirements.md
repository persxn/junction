# AI Hackathon & Event Intelligence Platform — Master Product + Development Prompt

> **Provenance.** Reconstructed verbatim by the architect from the product owner's messages of
> 20 Sep 2026: the original master prompt (§1–§48) and the requirements addendum (§49). Headings were
> converted to Markdown; wording is unchanged. **`docs/ARCHITECTURE.md` is the implementation source of
> truth**; where it refines or rules on something below, the architecture document wins.

You are acting as a Senior Software Architect, Product Engineer, Requirements Analyst, UI/UX Engineer, and AI Engineer.

Your job is to help me design and build a production-quality Windows desktop application based on the requirements in this document.

Do not immediately start writing large amounts of code.

First, understand the product, identify ambiguities and technical risks, ask the necessary questions, and propose an architecture. Once the requirements are sufficiently clear, help implement the system incrementally.

## 1. PRODUCT OVERVIEW

We are building an AI-powered Hackathon & Event Search Engine + Student Competition Management Platform.

The application is primarily intended for professors/faculty members who coordinate students participating in hackathons, coding competitions, innovation challenges, CTFs, and similar technical events.

The core problem is:

Professors currently have to manually search many different websites to find relevant competitions for their students. Events have different themes, eligibility requirements, locations, dates, team sizes, deadlines, submission requirements, and organizers. Existing event platforms generally provide filtering, but they do not provide a unified, intelligent, local-first interface that allows professors to naturally query events and simultaneously manage students and their competition preparation.

The application should solve two connected problems:

1. Discover relevant competitions automatically.
2. Manage students/teams and track their progress through those competitions.

## 2. INITIAL DEPLOYMENT SCOPE

The first version is intentionally limited.

Organization

* One university
* One department
* Multiple professors
* One or more administrators
* Students may belong to any department within the university
* Professors and administrators must belong to the configured department

This is not initially a public SaaS platform.

The architecture should, however, avoid unnecessarily preventing future expansion to multiple departments/universities.

## 3. APPLICATION TYPE

The application should be:

* Windows-only
* Desktop/local-first
* Optimized for laptops/desktops
* Fast and lightweight
* Modern and visually polished
* Able to function locally for its database, UI and AI
* Internet-dependent only where internet access is actually necessary

The initial architecture should aim for:

```text
LOCAL COMPUTER
│
├── Desktop UI
├── Local application/backend
├── Local database
├── Local AI/LLM
├── Scraping engine
└── Event processing/indexing
        │
        └── Internet
             ├── Event websites
             ├── College websites
             └── Competition platforms
```

The scraper requires internet access.

The database and LLM should remain local.

## 4. CORE PRODUCT MODULES

The application should consist of at least these major modules:

A. Event Discovery Engine — Automatically discover competitions/events from many sources.

B. Event Data Processing — Normalize, classify, deduplicate and enrich scraped events.

C. Local AI Search Assistant — Allow professors to search the event database using natural language through a small local LLM.

D. Student Management — Create and manage student profiles.

E. Team Management — Create teams and assign students.

F. Competition Management — Assign events to students/teams.

G. Progress/Workflow Management — Track preparation and submission stages.

H. Deadline & Notification System — Track deadlines and provide in-app reminders.

I. Administrative Management — Allow administrators to manage the department-wide system.

## 5. EVENT DISCOVERY

The application should scrape events from a broad range of sources.

Potential sources include, but are not limited to:

* Devfolio
* Unstop
* HackerEarth
* Devpost
* Dare2Compete / relevant successors
* IIT websites
* NIT websites
* University websites
* College websites
* Individual hackathon websites
* Competition platforms
* Coding competition platforms
* CTF platforms
* Innovation challenge websites
* Other legitimate publicly accessible event sources

Do not assume this list is exhaustive.

The architecture should make it possible to add new sources without rewriting the entire application.

Use a modular source/adapter architecture.

For example:

```text
Scraper Engine
│
├── DevfolioAdapter
├── UnstopAdapter
├── HackerEarthAdapter
├── DevpostAdapter
├── CollegeWebsiteAdapter
├── IITWebsiteAdapter
└── ...
```

Each adapter should convert source-specific information into a common internal event schema.

## 6. SCRAPER REQUIREMENTS

The scraper should:

* Run while the host application/device is active
* Refresh approximately every 15 minutes
* Support manual refresh
* Track the last successful scrape
* Track source status
* Handle failed sources gracefully
* Avoid crashing the application when one source fails
* Detect duplicate events
* Update existing events instead of blindly inserting duplicates
* Record the source(s) associated with an event
* Detect events that have closed/ended
* Handle changes to event information

The application should clearly communicate:

```text
Last updated: 4 minutes ago
```

and preferably:

```text
Source status
✓ Devfolio — Updated 4 min ago
✓ Unstop — Updated 7 min ago
⚠ College Website — Failed
```

## 7. EVENT DEDUPLICATION

The same event may appear on multiple websites.

For example:

```text
AI Innovation Hackathon 2026
```

may appear on:

* Devfolio
* Unstop
* IIT website
* Official event website

The system should attempt to identify these as the same event.

A single event should ideally contain:

```text
Event
├── Canonical event
├── Sources
│   ├── Devfolio
│   ├── Unstop
│   └── Official website
├── Source URLs
└── Last verified timestamps
```

Do not discard source information after deduplication.

## 8. EVENT DATA MODEL

Design a comprehensive normalized event schema.

At minimum consider:

* Event ID
* Event name
* Organizer
* Organizer type
* Description
* Event type
* Categories
* Themes
* Skills
* Technologies
* Eligibility
* Registration deadline
* Event start date
* Event end date
* Submission deadline
* Location
* Venue
* Latitude
* Longitude
* Distance from university
* Online/offline/hybrid
* Team minimum size
* Team maximum size
* Registration fee
* Prize information
* Requirements
* Submission requirements
* Event status
* Official website
* Registration URL
* Source URLs
* Sources
* Last scraped time
* Last verified time
* Created time
* Updated time

Do not blindly implement every field before evaluating whether it is actually useful.

Recommend improvements to this schema.

## 9. EVENT CATEGORIES

Events should be categorized in the frontend.

Categories should initially be configurable rather than hard-coded.

Potential categories include:

* AI
* Machine Learning
* LLM
* Cybersecurity
* Web Development
* App Development
* Cloud
* DevOps
* Blockchain
* Robotics
* IoT
* Data Science
* FinTech
* HealthTech
* EdTech
* Sustainability
* Open Innovation
* CTF
* Coding
* Ideathon
* Innovation Challenge
* Research
* Other

The administrator or authorized user should eventually be able to create/edit categories.

Events may belong to multiple categories.

## 10. LOCATION / DISTANCE

Distance must be calculated relative to the university campus, not the professor's current location.

The university campus location should be configurable.

Example filter:

```text
Within 50 km
```

Potential future filters:

```text
Within 10 km
Within 25 km
Within 50 km
Within 100 km
Within 250 km
Within 500 km
Anywhere
```

The system should distinguish between:

* Online
* Offline
* Hybrid

For physical events, calculate/display distance from campus.

Determine whether straight-line distance or road distance is more appropriate for the MVP and explain the tradeoff before implementation.

## 11. EVENT SEARCH

The normal UI should provide conventional filters.

Potential filters:

* Category
* Theme
* Technology
* Event type
* Location
* Distance
* Online/offline/hybrid
* Registration status
* Registration deadline
* Event date
* Organizer
* University/college
* Prize
* Registration fee
* Team size
* Eligibility

Filtering should be fast because it should operate against the local database/index.

## 12. LOCAL AI ASSISTANT

One of the defining features is a chatbot powered by a small locally running LLM.

The model should NOT be expected to memorize all event information.

Prefer an architecture such as:

```text
User Query
    ↓
Local LLM
    ↓
Intent / Query Extraction
    ↓
Structured Query
    ↓
Local Event Database / Search Index
    ↓
Relevant Events
    ↓
Local LLM
    ↓
Natural-language answer
```

This is essentially a local natural-language interface over the application's event database.

Example queries:

- Find AI hackathons within 300 km.
- Show offline cybersecurity events happening next month.
- Find hackathons with no registration fee.
- Which events are closing within 7 days?
- Find IIT and NIT hackathons suitable for our students.
- Which events can Team Alpha participate in?
- What competitions have we saved but not assigned to anyone?
- Which assigned competitions have deadlines this week?

The assistant should never fabricate event information.

If information is not available in the local database, it should clearly state that.

## 13. AI SHOULD EVENTUALLY CONTROL THE APPLICATION

The architecture should allow the AI assistant to eventually perform application actions.

Potential examples:

- Assign this event to Team Alpha.
- Show Rahul's active competitions.
- Create a team with Rahul, Aryan and Soham.
- Mark the PPT as complete.
- Show competitions closing this week.

Do not necessarily implement all of these in the MVP.

First implement safe read-only querying.

Then introduce controlled actions with explicit confirmation where appropriate.

## 14. STUDENT MANAGEMENT

Professors should be able to create/manage student entities.

Potential student fields:

* Student ID
* Name
* University ID
* Email
* Phone if required
* Department
* Course/branch
* Year
* Skills
* Technologies
* Interests
* Previous competitions
* Achievements
* Profile notes
* Active/inactive status

Students can participate in multiple events simultaneously.

Students may potentially belong to multiple teams.

Do not assume the student belongs to the same department as the professor.

## 15. STUDENT SKILL PROFILE

A student should be represented by more than just their name.

Example:

```text
Rahul Sharma

Skills:
- Python
- Machine Learning
- FastAPI
- React

Interests:
- AI
- Cybersecurity

Previous experience:
- 2 hackathons
- 1 finalist
```

This data can later be used by the AI assistant for event/team suitability analysis.

## 16. TEAM MANAGEMENT

Introduce a distinct Team entity.

Example:

```text
Team Alpha

Rahul       → Machine Learning
Soham       → Backend
Aryan       → Frontend
Priya       → UI/UX
```

A team should have:

* Team ID
* Team name
* Members
* Professor/mentor
* Skills
* Assigned events
* Status

Do not treat teams as merely a list of students attached to an event.

## 17. EVENT ASSIGNMENT

Professors should be able to:

* Save/watch an event
* Assign an event to a team
* Assign an event to individual students where appropriate
* View assigned competitions
* Remove assignments
* Track their progress

There should be a distinction between:

```text
Discovered
↓
Saved / Watchlisted
↓
Being Considered
↓
Assigned
↓
Applied
↓
Participating
↓
Completed
```

Do not force every discovered event to become an active project.

## 18. CUSTOMIZABLE WORKFLOWS

Different competitions have different requirements.

Do NOT hard-code one universal workflow.

For example:

Hackathon workflow

```text
Registration
↓
Team Formation
↓
Idea
↓
Research
↓
PPT
↓
Prototype
↓
Final Project
↓
Submission
```

CTF workflow

```text
Registration
↓
Team Formation
↓
Environment Setup
↓
Practice
↓
Competition
↓
Result
```

Professors should eventually be able to create/edit stages.

Each stage may contain:

* Name
* Description
* Assigned students
* Deadline
* Status
* Attachments
* Notes
* Completion percentage

## 19. PROGRESS TRACKING

The UI should provide an intuitive visual representation.

Example:

```text
Team Alpha
██████████████░░░░ 72%

Registration       ✓
Research           ✓
PPT                ✓
Prototype          ███████░░ 70%
Final Project      ░░░░░░░░░ 0%
Submission         ░░░░░░░░░ 0%
```

Progress should be calculated intelligently rather than simply being an arbitrary percentage.

The system should support:

* Not started
* In progress
* Completed
* Blocked
* Overdue

## 20. DEADLINE MANAGEMENT

Track multiple types of deadlines:

* Registration deadline
* Abstract deadline
* Submission deadline
* PPT deadline
* Research deadline
* Internal team deadline
* Event start date
* Event end date

The system should calculate remaining time.

Example:

```text
Registration closes in 2 days
```

Potential urgency levels:

```text
🔴 Closing today
🟠 Closing within 3 days
🟡 Closing within 7 days
🟢 More than 7 days
```

Do not use emojis if the final UI design would benefit from a cleaner visual system; use appropriate UI indicators instead.

## 21. IN-APP NOTIFICATIONS

Initial notification channel:

In-app only.

No email/WhatsApp/Discord integration is required for MVP.

Notifications should include things like:

```text
Registration closes tomorrow.

Team Alpha has an incomplete PPT stage.

A new AI hackathon was discovered within 50 km.

A tracked event's deadline changed.

A previously saved event has been cancelled.
```

Potential future notification channels can be considered but should not complicate the MVP.

## 22. DEADLINE RADAR

The dashboard should have a high-visibility deadline overview.

Example:

```text
DEADLINE RADAR

TODAY
1 event

NEXT 3 DAYS
4 events

NEXT 7 DAYS
11 events

NEXT 30 DAYS
32 events
```

Include both:

* Event registration deadlines
* Active project/task deadlines

## 23. DASHBOARD

The main dashboard should provide a useful summary.

Potential sections:

```text
Competition Intelligence

[ AI Search Bar ]

42 Upcoming Events
8 Closing Soon
6 Active Competitions
3 Overdue Tasks

--------------------------------

Deadline Radar

--------------------------------

Nearby Events

--------------------------------

Recommended / Relevant Events

--------------------------------

Active Teams

--------------------------------

Recent Notifications
```

The UI should be:

* Modern
* Clean
* Responsive
* Desktop-optimized
* Smooth
* Visually polished
* Not excessively animated

Animations should improve usability rather than simply add decoration.

## 24. ADMINISTRATOR

Administrators should have department-wide visibility.

Potential capabilities:

* Manage professors
* Manage student records
* View all teams
* View all competitions
* Manage categories
* Manage event sources
* Configure university information
* Configure campus coordinates
* Monitor scraper status
* View system health
* Manage application settings
* View audit logs

Professors should have more restricted permissions.

Design a proper RBAC model rather than scattering permission checks throughout the application.

## 25. PROFESSOR ACCESS

Professors should initially be able to:

* Manage their students
* Create teams
* Discover events
* Save events
* Assign events
* Track competition progress
* Create/edit workflows
* View relevant notifications

Whether professors can see other professors' students/teams is still an open product decision.

Do not assume the answer.

## 26. AUTHENTICATION

Authentication is not fully decided yet.

Possible approaches:

1. Local username/password
2. University email + password
3. Windows account identity
4. Other local authentication

Before implementing authentication, evaluate the options against:

* Windows desktop constraints
* Security
* Ease of deployment
* Local-first architecture
* Multi-user use
* Future expansion

Ask me before making an irreversible architectural decision.

## 27. DATABASE

The database should initially be local.

Evaluate suitable technologies based on:

* Windows compatibility
* Performance
* Reliability
* Easy deployment
* Local querying
* Future migration
* Concurrency if multiple users eventually share the database

Do not choose a database merely because it is popular.

Explain the tradeoffs before committing.

## 28. LOCAL LLM

The LLM should:

* Run locally
* Be small enough for typical university laptops
* Have low resource requirements
* Support structured output/function calling if practical
* Be replaceable/upgradable
* Never be the source of truth for event information

The database should be the source of truth.

Evaluate suitable local inference approaches/models.

Consider:

* CPU-only laptops
* Optional GPU acceleration
* RAM requirements
* Quantization
* Inference speed
* Context length
* Structured output reliability

Do not require a powerful dedicated GPU for the MVP.

## 29. SEARCH ARCHITECTURE

The application may benefit from more than traditional database filtering.

Evaluate:

* SQL filtering
* Full-text search
* Fuzzy matching
* Vector search
* Embeddings
* Hybrid search

A likely architecture is:

```text
Structured filters
+
Keyword/full-text search
+
Optional semantic search
```

Do not introduce a vector database just because the product contains an LLM.

Use the simplest architecture that satisfies the requirements.

## 30. SCRAPING SAFETY & ROBUSTNESS

The scraper must be resilient.

Handle:

* Website downtime
* HTML structure changes
* Rate limiting
* Duplicate pages
* Missing fields
* Invalid dates
* Changed URLs
* Cancelled events
* Closed registration
* JavaScript-rendered pages
* Network failures
* Timeouts

Do not make the entire application dependent on a single scraper source.

Respect applicable website terms, robots policies, rate limits, and access restrictions.

Prefer official/public APIs where legitimately available.

## 31. EVENT DATA QUALITY

Scraped data should not automatically be treated as perfect.

Consider a confidence/verification mechanism.

For example:

```text
Event information

Registration deadline
✓ Verified from official source

Prize
✓ Verified

Team size
⚠ Source disagreement
```

When multiple sources disagree, preserve the disagreement or prioritize a clearly defined authoritative source rather than silently inventing a value.

## 32. AUDITABILITY

The system should eventually be able to answer:

* Where did this event come from?
* When was it last scraped?
* When was this field last changed?
* Who assigned this event?
* Who changed the workflow?
* When was a task marked complete?

An audit log will be particularly useful for administrative use.

## 33. ERROR HANDLING

Never allow a single failed event source to crash the entire application.

The UI should show useful errors.

Bad:

```text
Error 500
```

Better:

```text
Unable to update Devfolio.

Last successful update:
14 minutes ago.

Retry
```

Errors should be logged locally for debugging.

## 34. SECURITY

Even though this is a local application, treat security seriously.

Consider:

* Password hashing if passwords are used
* Secure local storage
* Role-based access control
* Input validation
* Safe scraping
* SQL injection protection
* XSS protection where applicable
* Secure handling of scraped URLs
* File upload validation
* Audit logs
* Backup/recovery

Do not assume "local" means "security does not matter."

## 35. FILES / DOCUMENTS

Competition workflows may eventually contain:

* PPTX
* PDF
* DOCX
* Research papers
* Project files
* GitHub links
* Demo links
* Submission documents

The application should eventually support attaching or referencing these resources to workflow stages.

Do not over-engineer file storage in the first MVP.

Determine whether files should be:

* copied into application storage
* referenced by local path
* stored in a structured project directory

and explain the tradeoffs.

## 36. BACKUP / RESTORE

Because the system is local-first, data loss is a serious risk.

Consider:

* Manual backup
* Automatic backup
* Export database
* Restore database
* Export student/event data
* Export competition records

A local application should never assume its database is disposable.

## 37. MVP PRIORITIES

Prioritize the first release around the core problem.

MVP MUST HAVE

* Windows desktop application
* Local database
* Professor/admin authentication
* Event scraping
* Multiple event sources
* Normalized event records
* Source attribution
* Deduplication
* Event search
* Event filters
* Categories
* Distance from university
* Registration deadlines
* Event status
* Student management
* Team management
* Event assignment
* Custom workflow stages
* Progress tracking
* In-app notifications
* 15-minute scraper refresh
* Basic local AI search assistant

MVP SHOULD HAVE

* Watchlist
* Deadline Radar
* Scraper status
* Event freshness
* Fuzzy search
* Student skill profiles
* Workflow templates
* Audit logging
* Backup/export

POST-MVP

Potential future features:

* AI-driven student/team recommendations
* AI-generated event summaries
* AI-generated preparation plans
* Automated document checklist
* Email notifications
* WhatsApp notifications
* Discord/Telegram notifications
* Multi-department support
* Multi-university support
* Cloud synchronization
* Student-facing application
* Mobile application
* Advanced analytics
* Competition performance analytics
* Historical event analytics

Do not build post-MVP features prematurely.

## 38. IMPORTANT PRODUCT PRINCIPLES

Follow these principles while developing:

- **Principle 1 — Database is the source of truth.** The LLM should never invent event information.
- **Principle 2 — Local-first.** The application should remain useful even when cloud services are unavailable.
- **Principle 3 — Modular scraping.** Adding a new source should not require rewriting the entire application.
- **Principle 4 — Configurable workflows.** Do not hard-code one competition workflow.
- **Principle 5 — Explainable AI.** Whenever AI recommends/searches something, make it possible to understand why.
- **Principle 6 — Performance matters.** This application is intended to run on ordinary university laptops.
- **Principle 7 — Graceful failure.** Scraper failures should degrade functionality rather than crash the product.
- **Principle 8 — Don't over-engineer.** Prefer simple, maintainable architecture over unnecessary distributed systems.

## 39. OPEN PRODUCT QUESTIONS

Before finalizing architecture, explicitly ask me about unresolved decisions.

Important unresolved areas include:

1. Should students be globally shared across professors?
2. Can a student belong to multiple professors?
3. Can a student belong to multiple teams?
4. Can professors see each other's students?
5. Can professors see each other's assigned events?
6. What exactly can the administrator manage?
7. How should authentication work?
8. Will all professors use the same Windows machine or separate machines?
9. If multiple machines are used, how should data synchronize?
10. What exact university/campus location should be used?
11. Should distance be straight-line or road distance?
12. Which event sources are highest priority?
13. Which event types are included in the MVP?
14. Should event categories be manually assigned, AI-generated, or both?
15. How much automation should the AI assistant have?
16. What local LLM hardware should be supported?
17. Should files be stored inside the application or referenced from the filesystem?
18. What backup strategy should be used?

Do not silently make major decisions where these questions affect architecture.

## 40. DEVELOPMENT PROCESS

Follow this development process.

**Phase 1 — Requirements.** Before writing substantial code:

1. Read this entire document.
2. Summarize your understanding.
3. Identify contradictions.
4. Identify missing requirements.
5. Ask only the questions that materially affect architecture.
6. Propose an MVP scope.

**Phase 2 — Architecture.** Produce:

* System architecture
* Component diagram
* Data flow
* Database schema
* Entity relationships
* Authentication/authorization model
* Scraper architecture
* AI architecture
* Search architecture
* Notification architecture
* File/storage architecture

Explain important technology choices.

**Phase 3 — UX.** Design:

* Dashboard
* Event discovery
* Event detail
* AI assistant
* Students
* Teams
* Competition management
* Workflow/progress view
* Notifications
* Admin panel
* Settings

Prioritize usability for professors rather than developers.

**Phase 4 — Implementation.** Implement incrementally.

For each major module:

1. Explain what you're implementing.
2. Create the required files.
3. Implement it.
4. Test it.
5. Fix errors.
6. Document important decisions.
7. Move to the next module.

Do not generate a giant untested codebase in one step.

## 41. CODE QUALITY REQUIREMENTS

The implementation should be:

* Modular
* Maintainable
* Typed where appropriate
* Well documented
* Testable
* Secure
* Efficient
* Easy to extend

Avoid:

* Giant files
* God classes
* Hard-coded event sources
* Hard-coded workflows
* Hard-coded categories
* Business logic embedded directly inside UI components
* Duplicate logic
* Unnecessary dependencies

## 42. TESTING

Testing should cover at least:

Event ingestion

* Valid event
* Missing fields
* Invalid dates
* Duplicate events
* Conflicting sources
* Closed event

Scraper

* Source unavailable
* Timeout
* HTML changed
* Rate limit
* Partial failure

Search

* Keyword search
* Filters
* Distance
* Deadline
* Categories
* Natural-language queries

Students

* Create
* Edit
* Delete/deactivate
* Multiple events
* Multiple teams

Workflow

* Create stages
* Reorder stages
* Complete stage
* Overdue stage
* Custom deadlines

Permissions

* Admin
* Professor
* Unauthorized actions

AI

* Correct query extraction
* No hallucinated events
* Missing data
* Ambiguous queries
* Tool/action confirmation

## 43. UI/UX DIRECTION

The application should feel like a modern professional desktop productivity application.

Avoid making it look like:

* A generic CRUD admin dashboard
* An old university management system
* A developer-only tool

Use:

* Clear hierarchy
* Good spacing
* Cards where appropriate
* Smooth transitions
* Useful animations
* Strong filtering/search
* Visual deadline indicators
* Progress visualization
* Keyboard accessibility
* Responsive desktop layouts

Do not sacrifice performance for visual effects.

## 44. AI UX

The AI assistant should feel integrated into the application.

Example:

```text
┌─────────────────────────────────────────────┐
│ Ask about competitions...              ⌕    │
└─────────────────────────────────────────────┘

User:
Find AI hackathons within 250 km closing
within the next two weeks.

Assistant:

I found 7 matching events.

1. AI Innovation Challenge
   📍 180 km
   Registration closes: 27 Sep
   Source: Devfolio

2. ...
```

The user should be able to open an event directly from the AI response.

## 45. RECOMMENDATIONS

You are explicitly encouraged to identify features I have not considered.

However:

* Explain why a feature is useful.
* Separate MVP recommendations from future features.
* Do not add complexity without a clear benefit.
* Flag features that create substantial architectural consequences.

Think like a product architect, not just a programmer.

## 46. IMPORTANT: DO NOT ASSUME REQUIREMENTS

If a requirement is ambiguous:

1. Identify the ambiguity.
2. Explain why it matters.
3. Ask me a concise question.
4. Wait for the answer if it materially affects implementation.

Do not silently invent business rules.

For minor implementation details, make sensible decisions and document them.

## 47. FIRST TASK

Before writing the actual application code, perform the following:

- Step 1 — Summarize the product in your own words.
- Step 2 — Create a complete feature map.
- Step 3 — Separate features into: MVP · Phase 2 · Future.
- Step 4 — Identify all architectural risks.
- Step 5 — Identify missing requirements.
- Step 6 — Ask me the highest-priority unresolved questions.
- Step 7 — After I answer, produce: recommended tech stack · system architecture · database schema ·
  entity relationship diagram · scraper architecture · local LLM architecture · search architecture ·
  authentication architecture · UI structure · development roadmap.
- Step 8 — Only after architectural agreement should you begin implementation.

## 48. YOUR ROLE

Throughout this project, behave as a combination of:

* Senior Software Architect
* Product Manager
* Requirements Analyst
* Desktop Application Engineer
* AI/LLM Engineer
* Data Engineer
* UI/UX Engineer
* QA Engineer
* Security Engineer

Do not merely execute instructions mechanically.

If you see a better architecture, tell me.

If a requirement is technically problematic, tell me.

If something is unnecessary, tell me.

If something important is missing, tell me.

The goal is to build a useful, reliable, maintainable local-first competition intelligence platform, not merely to produce code.

**START**

Read the requirements above and begin with:

1. Your understanding of the product
2. Feature map
3. MVP definition
4. Architectural risks
5. Critical unanswered questions

Do not start implementing the full application until the requirements and architecture are sufficiently clear.

> **Working arrangement (from the same message):** one Claude session acts as the architect (research and
> architectural decisions, writes prompts); a Claude Code session on the product owner's Windows desktop
> is the worker (builds). The worker's feedback is pasted back to the architect, who issues further
> prompts to make the product more robust. A smooth and enjoyable UI is a goal.

---

## 49. REQUIREMENTS DECISIONS & PILOT CONSTRAINTS

The following decisions and defaults have been established after the initial requirements discussion.

Treat these as the **current product requirements** unless explicitly marked as unresolved.

Do not repeatedly ask questions that have already been answered here.

### A. ARCHITECTURE / DEPLOYMENT

#### A1. Professor application model

**Current direction.** The preferred architecture is:

```text
                DEPARTMENT BACKEND MACHINE
                ┌─────────────────────────┐
                │ Local Backend Service    │
                │                         │
                │ ├── Database            │
                │ ├── Scraper Engine      │
                │ ├── Local LLM            │
                │ ├── Search/Index        │
                │ └── Scheduler            │
                └───────────┬─────────────┘
                            │
                       Local API
                            │
             ┌──────────────┼──────────────┐
             ↓              ↓              ↓
        Professor A    Professor B    Administrator
        Desktop UI     Desktop UI     Desktop UI
```

The initial pilot will likely run the backend on **one machine**.

Design the system so that moving the backend to a dedicated always-on campus machine later does not require rewriting the application.

The desktop UI should communicate with the backend through a well-defined API boundary.

**Important.** Do not tightly couple the UI directly to the database. Use:

```text
UI → API → Application Services → Database
```

This should make future deployment changes easier.

**Open.** The following still needs confirmation:

* One shared PC for the pilot vs individual professor machines
* Whether professors require access from off campus
* Network configuration/security for remote access if required

#### A2. Department visibility

**Default: OPEN DEPARTMENT.** Professors should be able to see:

* All students
* All teams
* All competitions
* Department-wide event information

However:

* Only the owner or authorized co-mentor can edit their teams/competition workflows.
* Administrators have full access.

Students may simultaneously belong to:

* Multiple teams
* Multiple events
* Multiple mentor groups

Do not enforce one-student-one-team or one-student-one-professor relationships.

Use many-to-many relationships where appropriate.

#### A3. Hardware target

The application must run on:

**Minimum target: 8 GB RAM, no dedicated GPU.** The core application must remain usable on such a machine.

**AI recommendation.** The local AI experience should preferably target **16 GB RAM**.

GPU acceleration may be supported when available, but must not be mandatory for the MVP.

The architecture should therefore support:

```text
CPU-only inference
        +
Optional GPU acceleration
```

Do not select a model that effectively requires a high-end NVIDIA GPU.

During architecture design, provide realistic RAM/CPU/storage estimates for:

* 8 GB CPU-only machine
* 16 GB CPU-only machine
* 16 GB+ machine with NVIDIA GPU

#### A4. Campus location

The distance calculation must use the configured **university campus** as the reference point.

The exact university/campus will be provided separately.

Once provided:

* Store campus coordinates in configuration.
* Do not hard-code coordinates into application logic.
* Allow administrators to modify the campus location if necessary.

Distance should be:

> Approximate straight-line distance from campus.

Display it explicitly:

```text
~180 km (straight line)
```

#### A5. Pilot

The following pilot details are still to be provided:

* Pilot date
* Number of professors
* Host machine
* Who installs the application
* IT restrictions
* Who maintains scrapers after launch

Do not invent these details.

The architecture should nevertheless support a small pilot without requiring cloud infrastructure.

### B. AUTHENTICATION

#### B1. Initial authentication

Use local application accounts.

Accounts are created by the administrator.

Preferred security approach:

* Username/email
* Password
* Argon2id password hashing
* Session management
* Automatic lock after inactivity
* Role-based authorization

Initial roles:

```text
ADMINISTRATOR
PROFESSOR
```

Do not implement university SSO in the MVP.

Future authentication may support:

* Google Workspace
* Microsoft 365
* University SSO

The university's current identity provider is still to be confirmed.

Do not make SSO a dependency of the architecture.

### C. EVENT GEOGRAPHY

#### B2. Event types

The MVP should include:

* Hackathons
* Ideathons
* Innovation challenges
* CTFs
* Major coding contests

Weekly/repetitive rated contests such as regular Codeforces/LeetCode rounds should **not dominate the main event discovery feed**.

They should be hidden by default or placed in a separate contest/calendar view.

**Geographic rule.**

* In-person: only events physically located in India should be included by default.
* Online: online events can be worldwide.

Therefore:

```text
IN-PERSON → INDIA
ONLINE → WORLDWIDE
HYBRID → determine physical component/location
```

This is important for sources such as Devpost, where otherwise large numbers of US/local events could overwhelm the feed.

Make geography a configurable filtering rule rather than scattering country checks throughout scraper code.

### D. INITIAL EVENT SOURCES

#### B3. Priority sources

Initial sources to investigate:

1. Devfolio
2. Unstop
3. Devpost
4. CTFtime
5. CLIST

Also support:

6. Manual event creation
7. Manual event URL import

After the initial source implementation:

* IIT websites
* NIT websites
* University websites
* College websites

should be supported through configurable/adaptable source mechanisms.

**Important scraping rule.** Before implementing any scraper:

* Check the source's current terms/policies.
* Prefer legitimate public APIs where available.
* Respect robots policies where applicable.
* Respect rate limits.
* Do not attempt to bypass authentication, anti-bot systems, CAPTCHAs or access controls.

If a source cannot reasonably be scraped within these constraints, report it rather than building a brittle workaround.

### E. LOCAL AI

#### B4. MVP AI scope

The AI assistant is **READ-ONLY in the MVP**.

It may:

* Search events
* Filter events
* Explain results
* Summarize events
* Answer questions about locally stored events
* Answer questions about students/teams where the user has permission to view that data
* Identify relevant deadlines

It must NOT initially:

* Assign students
* Modify events
* Change workflow stages
* Mark tasks complete
* Delete records
* Change settings

Action-taking AI can be introduced in a future phase.

### F. FILE HANDLING

#### B5. MVP file strategy

Do NOT copy uploaded files into application storage in the MVP.

Instead, support:

* Local filesystem paths
* URLs
* GitHub URLs
* Other relevant external references

Example:

```text
PPT:
C:\Users\Professor\Documents\TeamAlpha\PPT.pptx

Research:
C:\Projects\TeamAlpha\research.pdf

GitHub:
https://github.com/example/team-alpha
```

The application should validate paths/URLs where practical but should not duplicate the files.

A future version may introduce managed project storage.

### G. BACKUPS

#### B6. Automatic backups

The application should perform:

**Automatic**

* Daily database snapshot
* Retain last 14 snapshots

**Manual**

* Backup now
* Restore backup

**Export.** Support:

* CSV
* Excel/XLSX

The backup destination should be configurable.

Example:

```text
D:\HackathonManager\Backups\
```

Do not hard-code a specific drive.

The system should warn if:

* Backup destination is unavailable
* Disk space is insufficient
* Backup fails

Consider whether the backup itself should be encrypted.

### H. SYSTEM TRAY

#### B7. Background operation

The application should be able to remain active in the Windows system tray after the main window is closed.

This is important because the scraper must continue operating every 15 minutes.

Expected behavior:

```text
Close Window
     ↓
Application minimizes to tray
     ↓
Backend/scheduler continues
     ↓
Scraping continues every 15 minutes
```

The user must be able to disable this behavior.

Tray menu should potentially include:

```text
Open Application
Refresh Events
Scraper Status
Notifications
Settings
Exit Completely
```

"Exit Completely" should stop background scraping.

### I. EVENT CATEGORIZATION

#### B8. Category assignment

Categories should initially be assigned using:

* Source-provided tags
* Deterministic rules
* Keyword/rule-based classification

Administrators can edit the global category list.

Professors can override the category of an individual event where permitted.

AI-generated categorization should be a **Phase 2** feature.

Do not require the LLM to classify every scraped event in the MVP.

### J. DISTANCE CALCULATION

#### B9. Distance

Use straight-line/geodesic distance from campus.

Display:

```text
~180 km (straight line)
```

Reasons:

* No routing API required
* No API cost
* Works offline
* Fast calculation
* Suitable for radius filtering

Default filters should include:

```text
Within 50 km
Within 100 km
Within 250 km
Within 500 km
Anywhere
```

Road distance is **not an MVP requirement**.

Do not introduce a paid routing API.

### K. BUDGET

#### B10. External API budget

Assume:

> **₹0 budget for paid APIs during the MVP.**

Avoid architectural dependencies on:

* Paid LLM APIs
* Paid geocoding APIs
* Paid routing APIs
* Paid search APIs
* Paid scraping services

Prefer:

* Local models
* Open-source libraries
* Local computation
* Public/free resources within their applicable limits

If a proposed feature genuinely requires a paid service, identify it explicitly and provide a no-cost MVP alternative.

### L. CODE SIGNING

Code signing is still an open deployment question.

Investigate:

* Whether a Windows code-signing certificate is necessary for the pilot
* Current certificate options
* Cost
* Whether the pilot can use unsigned/internal distribution
* Windows SmartScreen implications
* Whether the department/university has an existing certificate

Do not make paid code signing a mandatory MVP dependency unless required by the deployment environment.

### M. RECOMMENDED EVENT FEED STRUCTURE

Because the system covers many event types, the main feed should prevent repetitive contests from overwhelming high-value hackathons.

Consider a structure such as:

```text
EVENT DISCOVERY

Featured / Relevant
│
├── Nearby
├── Closing Soon
├── New
└── Recommended

All Events
│
├── Hackathons
├── Ideathons
├── Innovation
├── CTFs
└── Coding Contests

Contest Calendar
│
└── Recurring / Weekly Competitions
```

This is a recommendation for UX, not a fixed requirement.

### N. RECOMMENDATION ENGINE

The exact definition of "Recommended Events" is still open.

Potential recommendation signals include:

* Department-wide interests
* Professor interests
* Student skill profiles
* Student interests
* Event distance
* Event type
* Event difficulty
* Eligibility
* Deadlines
* Historical participation
* Previous outcomes

For MVP, avoid building a sophisticated machine-learning recommendation engine.

Start with explainable rule-based relevance.

For example:

```text
Why relevant?

✓ AI/ML matches student's skills
✓ Within 250 km
✓ Team size compatible
✓ Registration currently open
✓ Event hosted by an eligible institution
```

AI-powered recommendations can be Phase 2.

### O. NOTIFICATIONS

Initial notification channel:

> In-app only.

Notification ownership and exact thresholds are still open.

Potential default thresholds:

```text
7 days
3 days
1 day
```

But do not implement notification rules until the ownership model is confirmed.

Potential notification categories:

* Registration deadline
* Submission deadline
* Internal task deadline
* Overdue task
* New matching event
* Event information changed
* Event cancelled
* Scraper failure
* Backup failure

### P. PROFESSOR OWNERSHIP / CO-MENTORSHIP

The system should support the concept of:

```text
Competition
├── Primary mentor
└── Co-mentors
```

The exact permissions are still to be finalized.

The architecture should not assume there can only ever be one professor attached to a competition.

The system should also support transferring ownership when a professor leaves the department.

Example:

```text
Professor A leaves
       ↓
Administrator transfers
       ↓
Team Alpha
Competition X
Students
Tasks
History
       ↓
Professor B
```

Historical audit information should remain intact.

### Q. STUDENT TEAM MEMBERSHIP

Students may:

* Participate in multiple teams
* Participate in multiple events
* Work with multiple mentors

The application should not assume:

```text
Student → one team
```

Instead use appropriate many-to-many relationships.

Whether teams can contain students from:

* Other departments
* Other universities/colleges

is still an open requirement.

The data model should not make cross-department students impossible.

### R. COMPETITION OUTCOMES

Outcome tracking is recommended.

Potential fields:

* Participated
* Did not participate
* Qualified
* Finalist
* Winner
* Runner-up
* Rank
* Prize
* Certificate
* Result URL
* Notes
* Feedback

This should be considered part of the competition lifecycle.

The exact MVP scope remains to be finalized.

### S. STUDENT PRIVACY

Student information should be minimized.

Do not collect personal information merely because it is technically possible.

Only collect fields required for:

* Identification
* Team management
* Competition eligibility
* Communication where genuinely necessary
* Competition history
* Skill matching

The exact personal fields and consent requirements remain to be determined.

If the application stores personally identifiable information, include appropriate:

* Access controls
* Data minimization
* Secure storage
* Backup considerations
* Deletion/deactivation mechanisms

### T. OFFLINE BEHAVIOR

The intended model is:

```text
OFFLINE

✓ View events already scraped
✓ Search local events
✓ Filter events
✓ View students
✓ View teams
✓ Update local records
✓ Manage workflows
✓ View notifications
✓ Use local AI where hardware permits

INTERNET REQUIRED

✓ Scraping
✓ Refreshing external event information
✓ Importing external event URLs
✓ Accessing external links
```

The application should gracefully indicate when internet connectivity is unavailable.

It should not treat an internet outage as an application failure.

### U. AUDIT LOG

An audit log is recommended for administrative accountability.

Potential events:

* Login
* Student created/edited/deactivated
* Team created/modified
* Competition assigned
* Workflow changed
* Task completed
* Event manually modified
* Category changed
* Professor created/deactivated
* Ownership transferred
* Backup/restoration performed
* Settings changed

Exact retention duration and visibility are still open.

Administrators should have access to the audit log.

### V. UI THEMING

Support:

* Light mode
* Dark mode

Prefer following the Windows system theme by default, if technically appropriate.

Accessibility should include at least:

* Keyboard navigation
* Readable typography
* Adequate contrast
* Clear status indicators
* Avoiding color as the only indicator of state
* Reasonable scaling for different display sizes

### W. IMPORTANT ARCHITECTURAL CONSEQUENCE

The requirements above suggest the following conceptual architecture:

```text
┌──────────────────────────────────────────────────────┐
│                 WINDOWS APPLICATION                  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                Desktop UI                      │  │
│  │                                                │  │
│  │ Dashboard | Events | Students | Teams | AI     │  │
│  └───────────────────────┬────────────────────────┘  │
│                          │                           │
│                       Local API                     │
│                          │                           │
│  ┌───────────────────────▼────────────────────────┐  │
│  │              APPLICATION BACKEND               │  │
│  │                                                │  │
│  │ Auth / RBAC                                    │  │
│  │ Event Service                                  │  │
│  │ Student Service                                │  │
│  │ Team Service                                   │  │
│  │ Workflow Service                               │  │
│  │ Notification Service                           │  │
│  │ Search Service                                 │  │
│  │ Backup Service                                 │  │
│  └───────────────┬───────────────┬────────────────┘  │
│                  │               │                   │
│          ┌───────▼──────┐ ┌──────▼──────────┐        │
│          │ Local DB     │ │ Local AI        │        │
│          │              │ │                 │        │
│          │ Events       │ │ Small LLM       │        │
│          │ Students     │ │ Query parsing   │        │
│          │ Teams        │ │ Summarization   │        │
│          │ Workflows    │ │                 │        │
│          └──────────────┘ └─────────────────┘        │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              SCRAPER ENGINE                    │  │
│  │                                                │  │
│  │ Devfolio | Unstop | Devpost | CTFtime | CLIST │  │
│  │ IIT/NIT adapters | Manual Import              │  │
│  └───────────────────────┬────────────────────────┘  │
└──────────────────────────┼───────────────────────────┘
                           │
                        INTERNET
```

This is the **conceptual architecture only**.

Do not implement this exact structure without first evaluating:

* Technology choices
* Process boundaries
* API mechanism
* Database choice
* LLM runtime
* Search implementation
* Packaging/deployment
* Resource consumption

### X. UPDATED IMMEDIATE TASK FOR CLAUDE

Using both the original product requirements and this addendum:

- **First** — Update your understanding of the product.
- **Second** — Identify which requirements are now resolved.
- **Third** — Identify only the genuinely unresolved questions. Do not repeat questions already answered above.
- **Fourth** — Produce a recommended architecture with at least: desktop framework · backend framework ·
  database · ORM/data layer · search engine/index · scraper technology · scheduler · local LLM runtime ·
  recommended model class/size · authentication · packaging · Windows installer strategy · logging ·
  testing framework · backup strategy. For every major technology choice, briefly explain: why it fits
  this product · resource requirements · main downside · alternative considered.
- **Fifth** — Produce a database/entity model covering: users · roles · professors · students · teams ·
  mentorship · events · event sources · event categories · event assignments · workflows · workflow
  stages · tasks · notifications · audit logs · backups/configuration where appropriate.
- **Sixth** — Produce the MVP implementation roadmap. Break development into small, testable
  milestones. Do not generate the entire application in one response.

### FINAL DEVELOPMENT RULE

This product is intended to become a real application used by university faculty.

Optimize for:

**Reliability > maintainability > usability > performance > feature count**

Do not chase unnecessary technical complexity.

Build the smallest architecture that can reliably support the defined product and can later grow into a multi-department/multi-university system.

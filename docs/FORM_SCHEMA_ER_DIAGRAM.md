# Form Module Entity-Relationship Diagram

## Complete ER Diagram

```mermaid
erDiagram
    users ||--o{ forms : "creates"
    users ||--o{ form_module_preferences : "has"
    users ||--o{ workflows : "creates"
    projects ||--o{ forms : "contains"
    forms ||--o{ form_submissions : "receives"
    forms ||--o{ workflows : "triggers"
    form_submissions ||--o{ payments : "includes"
    
    users {
        uuid id PK
        varchar email UK
        varchar password_hash
        varchar full_name
        timestamp created_at
        timestamp updated_at
    }
    
    projects {
        uuid id PK
        varchar name
        text description
        uuid created_by FK
        timestamp created_at
        timestamp updated_at
    }
    
    forms {
        uuid id PK
        uuid project_id FK
        varchar slug UK "Public URL identifier"
        varchar title
        text description
        jsonb fields "Array of field definitions"
        jsonb settings "Configuration object"
        varchar status "draft|published|archived"
        uuid created_by FK
        timestamp created_at
        timestamp updated_at
    }
    
    form_submissions {
        uuid id PK
        uuid form_id FK
        jsonb data "Field answers and metadata"
        uuid submitted_by FK
        timestamp submitted_at
        varchar ip_address
        text user_agent
    }
    
    workflows {
        uuid id PK
        uuid form_id FK
        varchar name
        varchar trigger_event
        jsonb actions "Array of action definitions"
        boolean enabled
        uuid created_by FK
        timestamp created_at
        timestamp updated_at
    }
    
    payments {
        uuid id PK
        uuid submission_id FK
        decimal amount
        varchar currency
        varchar provider "stripe|paystack|flutterwave|opay"
        varchar transaction_id
        varchar status "pending|completed|failed|refunded"
        timestamp payment_date
        timestamp created_at
    }
    
    form_module_preferences {
        uuid id PK
        uuid user_id FK,UK
        jsonb preferences "User default settings"
        timestamp created_at
        timestamp updated_at
    }
```

---

## Detailed JSONB Structure Diagrams

### forms.fields Array Structure

```mermaid
graph TD
    A[forms.fields JSONB Array] --> B[Field Object 1]
    A --> C[Field Object 2]
    A --> D[Field Object N]
    
    B --> B1[id: string]
    B --> B2[type: FormFieldType]
    B --> B3[label: string]
    B --> B4[placeholder?: string]
    B --> B5[helpText?: string]
    B --> B6[required?: boolean]
    B --> B7[options?: string array]
    B --> B8[validation?: object]
    
    B2 --> B2A[Text Types]
    B2 --> B2B[Choice Types]
    B2 --> B2C[Date Types]
    B2 --> B2D[Media Types]
    B2 --> B2E[Structure Types]
    B2 --> B2F[Commerce Types]
    
    B2A --> B2A1[shortText]
    B2A --> B2A2[longText]
    B2A --> B2A3[email]
    B2A --> B2A4[phone]
    B2A --> B2A5[number]
    B2A --> B2A6[url]
    
    B2B --> B2B1[dropdown]
    B2B --> B2B2[radio]
    B2B --> B2B3[checkboxes]
    B2B --> B2B4[yesNo]
    B2B --> B2B5[rating]
    B2B --> B2B6[ranking]
    
    B8 --> B8A[min?: number]
    B8 --> B8B[max?: number]
    B8 --> B8C[pattern?: string]
```

### forms.settings Object Structure

```mermaid
graph TD
    A[forms.settings JSONB Object] --> B[logic: array]
    A --> C[theme: object]
    A --> D[payment: object]
    A --> E[confirmation: object]
    A --> F[notifications: object]
    A --> G[access: object]
    A --> H[limits: object]
    A --> I[schedule: object]
    A --> J[lifecycle: string]
    A --> K[version: number]
    A --> L[versions: array]
    A --> M[liveSnapshot: object]
    A --> N[hasUnpublishedChanges: boolean]
    
    B --> B1[Logic Rule 1]
    B --> B2[Logic Rule N]
    B1 --> B1A[sourceFieldId]
    B1 --> B1B[operator]
    B1 --> B1C[value]
    B1 --> B1D[action]
    B1 --> B1E[targetFieldId]
    
    C --> C1[accentColor]
    C --> C2[backgroundColor]
    C --> C3[fontFamily]
    C --> C4[fontSize]
    C --> C5[buttonStyle]
    C --> C6[respondentMode]
    
    D --> D1[enabled]
    D --> D2[mode]
    D --> D3[provider]
    D --> D4[amount]
    D --> D5[currency]
    
    G --> G1[mode: public|password|authenticated]
    G --> G2[password: string]
    
    J --> J1[active]
    J --> J2[paused]
```

### form_submissions.data Object Structure

```mermaid
graph TD
    A[form_submissions.data JSONB] --> B["field-uuid-1: value"]
    A --> C["field-uuid-2: value"]
    A --> D["field-uuid-N: value"]
    A --> E["_meta: object"]
    
    E --> E1[status: completed|partial]
    E --> E2[formVersion: number]
    E --> E3[paymentStatus: string]
    E --> E4[referrer: string]
    E --> E5[utm: object]
    
    E5 --> E5A[source]
    E5 --> E5B[medium]
    E5 --> E5C[campaign]
    E5 --> E5D[term]
    E5 --> E5E[content]
```

---

## Form Lifecycle State Diagram

```mermaid
stateDiagram-v2
    [*] --> Draft: Create Form
    
    Draft --> Published: Publish
    Draft --> Archived: Archive
    
    Published --> Published_Paused: Pause
    Published_Paused --> Published: Resume
    
    Published --> Published_HasChanges: Edit Draft
    Published_HasChanges --> Published: Republish
    
    Published --> Archived: Archive
    Published_Paused --> Archived: Archive
    Published_HasChanges --> Archived: Archive
    
    Archived --> Draft: Restore as Draft
    Archived --> Published: Restore as Published
    
    Archived --> [*]: Delete
    
    note right of Draft
        status: "draft"
        lifecycle: n/a
        hasUnpublishedChanges: false
    end note
    
    note right of Published
        status: "published"
        lifecycle: "active"
        hasUnpublishedChanges: false
    end note
    
    note right of Published_Paused
        status: "published"
        lifecycle: "paused"
        Public access blocked
    end note
    
    note right of Published_HasChanges
        status: "published"
        hasUnpublishedChanges: true
        liveSnapshot: previous version
    end note
    
    note right of Archived
        status: "archived"
        archivedFromStatus: original
        No public access
    end note
```

---

## Form Publishing Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as Form Builder UI
    participant API as Forms API
    participant DB as Database
    
    User->>UI: Edit form fields
    UI->>API: saveWorkspaceForm(draft)
    API->>DB: UPDATE forms SET fields=..., hasUnpublishedChanges=true
    DB-->>API: Updated form
    API-->>UI: Form saved
    
    User->>UI: Click "Publish"
    UI->>API: saveWorkspaceForm(publish)
    
    Note over API: Create version snapshot
    API->>API: Increment version number
    API->>API: Add to settings.versions array
    API->>API: Set settings.liveSnapshot
    API->>API: Set hasUnpublishedChanges=false
    API->>API: Set status="published"
    
    API->>DB: UPDATE forms
    DB-->>API: Published form
    API-->>UI: Form published
    UI-->>User: Success message
    
    Note over User,DB: Public URL now serves liveSnapshot version
```

---

## Form Submission Flow

```mermaid
sequenceDiagram
    actor Respondent
    participant Public as Public Form Page
    participant API as Forms API
    participant DB as Database
    participant Workflow as Workflow Engine
    participant Payment as Payment Provider
    
    Respondent->>Public: Visit /f/{slug}
    Public->>API: getPublicForm(slug)
    API->>DB: SELECT * FROM forms WHERE slug=...
    DB-->>API: Form record
    
    Note over API: Check if liveSnapshot exists
    alt Has liveSnapshot
        API->>API: Use liveSnapshot.fields
    else No liveSnapshot
        API->>API: Use form.fields
    end
    
    API-->>Public: Form definition
    Public-->>Respondent: Render form
    
    Respondent->>Public: Fill and submit form
    Public->>API: submitPublicForm(answers)
    
    alt Payment enabled
        API->>Payment: Initialize payment
        Payment-->>API: Payment session
        API-->>Public: Redirect to payment
        Respondent->>Payment: Complete payment
        Payment->>API: Payment webhook
        API->>DB: INSERT INTO payments
    end
    
    API->>DB: INSERT INTO form_submissions
    DB-->>API: Submission ID
    
    API->>Workflow: Trigger workflows
    Workflow->>Workflow: Process actions
    Note over Workflow: Email, webhook, etc.
    
    API-->>Public: Success response
    Public-->>Respondent: Show confirmation
```

---

## Data Access Pattern

```mermaid
graph LR
    A[React Component] --> B[lib/forms.ts]
    B --> C[lib/db.ts]
    C --> D[(PostgreSQL)]
    
    B --> B1[listWorkspaceForms]
    B --> B2[createWorkspaceForm]
    B --> B3[saveWorkspaceForm]
    B --> B4[deleteWorkspaceForm]
    B --> B5[listFormSubmissions]
    B --> B6[submitPublicForm]
    
    D --> D1[forms table]
    D --> D2[form_submissions table]
    D --> D3[workflows table]
    D --> D4[payments table]
    D --> D5[form_module_preferences table]
    
    B1 --> C
    B2 --> C
    B3 --> C
    B4 --> C
    B5 --> C
    B6 --> C
    
    style A fill:#e1f5ff
    style B fill:#fff4e1
    style C fill:#ffe1e1
    style D fill:#e1ffe1
```

---

## JSONB Query Performance

```mermaid
graph TD
    A[Query forms.settings] --> B{Query Type}
    
    B -->|Containment| C[Use @> operator]
    B -->|Equality| D[Use ->> operator]
    B -->|Existence| E[Use ? operator]
    
    C --> C1[settings @> json-object]
    C --> C2[Fast with GIN index]
    
    D --> D1[settings->>'key' = value]
    D --> D2[Slower, full scan]
    
    E --> E1[settings ? 'key']
    E --> E2[Fast with GIN index]
    
    F[Solution] --> G[Add GIN index]
    G --> H[CREATE INDEX ... USING gin-settings]
    
    style C2 fill:#90EE90
    style D2 fill:#FFB6C1
    style E2 fill:#90EE90
```

---

## Index Strategy

```mermaid
graph TD
    A[Database Indexes] --> B[Standard B-Tree]
    A --> C[GIN Indexes]
    A --> D[Unique Constraints]
    
    B --> B1[Primary Keys]
    B --> B2[Foreign Keys]
    B --> B3[Composite Indexes]
    
    B1 --> B1A[All PK columns]
    B2 --> B2A[form_id on submissions]
    B2 --> B2B[submission_id on payments]
    B2 --> B2C[created_by on forms]
    
    B3 --> B3A[created_by + status]
    B3 --> B3B[form_id + submitted_at]
    B3 --> B3C[status + payment_date]
    
    C --> C1[JSONB Columns]
    C1 --> C1A[forms.fields]
    C1 --> C1B[forms.settings]
    C1 --> C1C[form_submissions.data]
    C1 --> C1D[workflows.actions]
    
    D --> D1[forms.slug]
    D --> D2[users.email]
    D --> D3[form_module_preferences.user_id]
    
    style C fill:#FFD700
    style C1 fill:#FFD700
    style C1A fill:#FFD700
    style C1B fill:#FFD700
    style C1C fill:#FFD700
    style C1D fill:#FFD700
```

---

## Form Module Architecture

```mermaid
graph TB
    subgraph "Frontend Layer"
        A[FormsModule.tsx]
        B[FormBuilder.tsx]
        C[FormRenderer.tsx]
        D[form-types.ts]
    end
    
    subgraph "Data Access Layer"
        E[lib/forms.ts]
        F[lib/db.ts]
    end
    
    subgraph "Database Layer"
        G[(PostgreSQL)]
        H[forms table]
        I[form_submissions]
        J[workflows]
        K[payments]
    end
    
    A --> E
    B --> E
    C --> E
    E --> F
    F --> G
    G --> H
    G --> I
    G --> J
    G --> K
    
    A -.uses types.-> D
    B -.uses types.-> D
    C -.uses types.-> D
    E -.uses types.-> D
    
    style A fill:#4CAF50
    style B fill:#4CAF50
    style C fill:#4CAF50
    style E fill:#2196F3
    style F fill:#2196F3
    style G fill:#FF9800
    style H fill:#FF9800
    style I fill:#FF9800
    style J fill:#FF9800
    style K fill:#FF9800
```

---

## Table Relationship Summary

| Parent Table | Child Table | Relationship | Cascade Delete |
|--------------|-------------|--------------|----------------|
| users | forms | 1:N | No |
| users | form_module_preferences | 1:1 | Yes |
| users | workflows | 1:N | No |
| projects | forms | 1:N | Yes |
| forms | form_submissions | 1:N | Yes |
| forms | workflows | 1:N | Yes |
| form_submissions | payments | 1:N | Yes |

---

## JSONB Column Summary

| Table | Column | Type | Contains |
|-------|--------|------|----------|
| forms | fields | Array | Field definitions with types, validation, options |
| forms | settings | Object | Logic, theme, payment, access, versioning |
| form_submissions | data | Object | Field answers mapped by field ID + metadata |
| workflows | actions | Array | Workflow action definitions |
| form_module_preferences | preferences | Object | User default settings |

---

This ER diagram provides a complete visual representation of the Form Module database schema, showing all relationships, JSONB structures, state flows, and architectural patterns.

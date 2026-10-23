# Form Module Database Schema - Visual Guide

A visual, beginner-friendly guide to understanding the Form Module database schema.

---

## 📊 The Big Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                     FORM MODULE DATABASE                         │
│                                                                  │
│  Everything about forms lives in PostgreSQL                     │
│  No local storage • No cache • Database is the truth            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🗂️ The 7 Tables

Think of the database as a filing cabinet with 7 drawers:

```
📁 forms                  → "The master drawer" - All form designs
📁 form_submissions       → "The responses" - What people submitted
📁 workflows             → "The automation" - Email, webhooks
📁 payments              → "The money" - Payment records
📁 form_module_preferences → "User defaults" - Personal settings
📁 projects              → "Folders" - Group related forms
📁 users                 → "The owners" - Who created what
```

---

## 📝 How a Form is Stored

### The `forms` Table

Think of it like a form template with metadata:

```
┌─────────────────────────────────────────┐
│ Form: "Customer Survey"                 │
├─────────────────────────────────────────┤
│                                         │
│ 🆔 ID:       abc-123-def                │
│ 🔗 Slug:     customer-survey            │
│ 📋 Status:   Published                  │
│                                         │
│ ┌─────────────────────────────────┐   │
│ │ Fields (JSONB Array):           │   │
│ │                                 │   │
│ │ [Field 1] What is your name?    │   │
│ │ [Field 2] Email address         │   │
│ │ [Field 3] How satisfied are you?│   │
│ └─────────────────────────────────┘   │
│                                         │
│ ┌─────────────────────────────────┐   │
│ │ Settings (JSONB Object):        │   │
│ │                                 │   │
│ │ • Theme (colors, fonts)         │   │
│ │ • Logic (show/hide rules)       │   │
│ │ • Payment (if collecting money) │   │
│ │ • Access (public/password)      │   │
│ │ • Version history               │   │
│ └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎯 What is JSONB?

JSONB is like a **flexible container** for complex data:

### Traditional Way (Rigid)
```
Table: form_fields
- id
- form_id
- type
- label
- placeholder
- required
- min_value
- max_value
...
```
❌ Every new feature = new column  
❌ Lots of empty cells  
❌ Complex to query  

### JSONB Way (Flexible)
```
Table: forms
- fields: [
    {
      "id": "field-1",
      "type": "shortText",
      "label": "Name",
      "required": true,
      "validation": {"min": 2}
    },
    {
      "id": "field-2",
      "type": "email",
      "label": "Email"
    }
  ]
```
✅ Add new features anytime  
✅ No empty cells  
✅ Still searchable with indexes  

---

## 🔄 Form Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  1️⃣  CREATE                                                      │
│     User clicks "New Form"                                      │
│     Status: Draft                                               │
│                                                                  │
│     ↓                                                           │
│                                                                  │
│  2️⃣  EDIT                                                        │
│     User adds fields, changes colors                            │
│     Still Draft - not public yet                                │
│                                                                  │
│     ↓                                                           │
│                                                                  │
│  3️⃣  PUBLISH                                                     │
│     User clicks "Publish"                                       │
│     • Creates a "snapshot" of current version                   │
│     • Status changes to Published                               │
│     • Form goes live at /f/{slug}                               │
│                                                                  │
│     ↓                                                           │
│                                                                  │
│  4️⃣  CONTINUE EDITING (Optional)                                │
│     User makes more changes to draft                            │
│     • Public sees OLD version (the snapshot)                    │
│     • Draft has new changes                                     │
│     • Flag: "hasUnpublishedChanges = true"                      │
│                                                                  │
│     ↓                                                           │
│                                                                  │
│  5️⃣  REPUBLISH                                                   │
│     User clicks "Publish" again                                 │
│     • Creates NEW snapshot                                      │
│     • Public now sees new version                               │
│     • Version number increments                                 │
│                                                                  │
│     ↓                                                           │
│                                                                  │
│  6️⃣  PAUSE (Optional)                                            │
│     Temporarily disable public access                           │
│     • Form still exists                                         │
│     • Public gets "Form is closed" message                      │
│                                                                  │
│     ↓                                                           │
│                                                                  │
│  7️⃣  ARCHIVE                                                     │
│     Hide from main list                                         │
│     • Data preserved                                            │
│     • Can be restored later                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📨 How Submissions Work

When someone fills out your form:

```
┌─────────────────────────────────────────────────────────────────┐
│                    FORM SUBMISSION JOURNEY                       │
└─────────────────────────────────────────────────────────────────┘

1. Person visits /f/customer-survey
   └─ System fetches form from database
   
2. Person sees the form
   └─ System uses "liveSnapshot" if it exists
   
3. Person fills out fields
   [Name: John Doe        ]
   [Email: john@email.com ]
   [Rating: ⭐⭐⭐⭐⭐       ]
   
4. Person clicks Submit
   └─ System validates answers
   
5. If payment enabled
   └─ System charges card
   └─ Creates payment record
   
6. System saves submission
   └─ INSERT INTO form_submissions
   
7. System triggers workflows
   └─ Send email notification
   └─ Call webhook
   └─ Create contact in CRM
```

### What Gets Saved

```json
{
  "field-name-001": "John Doe",
  "field-email-002": "john@email.com",
  "field-rating-003": 5,
  "_meta": {
    "status": "completed",
    "formVersion": 1,
    "referrer": "https://google.com",
    "submittedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## 🎨 The 30+ Field Types

### Text Fields (6 types)
```
┌─────────────────────────────────────────┐
│ Short Text    [_________________]       │
│ Long Text     [_________________]       │
│               [_________________]       │
│ Email         [___@___.___]             │
│ Phone         [(___) ___-____]          │
│ Number        [_____] 🔢                │
│ URL           [https://___]             │
└─────────────────────────────────────────┘
```

### Choice Fields (6 types)
```
┌─────────────────────────────────────────┐
│ Dropdown      [Select ▼]                │
│ Radio         ○ Option A                │
│               ○ Option B                │
│ Checkboxes    ☑ Option A                │
│               ☐ Option B                │
│ Yes/No        ⭘ Yes  ○ No               │
│ Rating        ⭐⭐⭐⭐⭐                     │
│ Ranking       Drag to order items       │
└─────────────────────────────────────────┘
```

### Date & Time (4 types)
```
┌─────────────────────────────────────────┐
│ Date          [📅 Jan 15, 2024]         │
│ Time          [🕐 10:30 AM]             │
│ Date Range    [Jan 1] to [Jan 31]      │
│ Appointment   [Book a time slot]        │
└─────────────────────────────────────────┘
```

### Media (4 types)
```
┌─────────────────────────────────────────┐
│ File Upload   [Choose File]             │
│ Image Choice  [📷] [📷] [📷]            │
│ Signature     [✍️ Sign here]            │
│ Camera        [📸 Take photo]           │
└─────────────────────────────────────────┘
```

### Structure (4 types)
```
┌─────────────────────────────────────────┐
│ Section       ═══ CONTACT INFO ═══      │
│ Page Break    ─── Page 1 of 3 ───       │
│ Heading       ## Your Details           │
│ Divider       ─────────────────────     │
└─────────────────────────────────────────┘
```

### Commerce (3 types)
```
┌─────────────────────────────────────────┐
│ Payment       💳 $50.00                 │
│ Product       [Choose] $29.99           │
│ Coupon        [Enter code]              │
└─────────────────────────────────────────┘
```

### Special (2 types)
```
┌─────────────────────────────────────────┐
│ Hidden        (not visible to user)     │
│ Calculated    Total: {qty} × {price}    │
└─────────────────────────────────────────┘
```

---

## 🔀 Conditional Logic Example

**Scenario:** Show shipping address only if product requires shipping

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  IF:     [Product]                                              │
│          equals                                                  │
│          "Physical Product"                                      │
│                                                                  │
│  THEN:   Show "Shipping Address" field                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**How it's stored:**
```json
{
  "id": "logic-1",
  "sourceFieldId": "field-product",
  "operator": "equals",
  "value": "Physical Product",
  "action": "show",
  "targetFieldId": "field-shipping-address"
}
```

**Other operators:**
- `equals` - Exact match
- `not_equals` - Does not match
- `contains` - Text includes
- `greater_than` - Number > value
- `less_than` - Number < value
- `is_answered` - Has any value

**Other actions:**
- `show` - Display field
- `hide` - Hide field
- `require` - Make required
- `skip_to` - Jump to another field

---

## 💰 Payment Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                     PAYMENT FLOW                                 │
└─────────────────────────────────────────────────────────────────┘

1. Enable payment in form settings
   └─ Choose provider: Stripe, Paystack, etc.
   └─ Set amount or mode (fixed/variable/product)

2. User fills form
   
3. User clicks submit
   └─ Redirect to payment provider
   
4. User enters card details
   
5. Payment processes
   └─ Provider sends webhook
   
6. System saves two records:
   ┌────────────────────────────────┐
   │ form_submissions table         │
   │ • All form answers             │
   │ • Status: "completed"          │
   │ • paymentStatus: "completed"   │
   └────────────────────────────────┘
   
   ┌────────────────────────────────┐
   │ payments table                 │
   │ • Amount: $50.00               │
   │ • Provider: stripe             │
   │ • Status: completed            │
   │ • Transaction ID: ch_abc123    │
   └────────────────────────────────┘

7. Send confirmation email
```

---

## 🤖 Workflows (Automation)

When a form is submitted, automatically:

```
┌─────────────────────────────────────────┐
│        WORKFLOW ACTIONS                 │
├─────────────────────────────────────────┤
│                                         │
│  📧 Send Email                          │
│     To: admin@company.com               │
│     Subject: New submission             │
│                                         │
│  🔗 Call Webhook                        │
│     POST https://api.company.com        │
│     Body: {form data}                   │
│                                         │
│  👤 Create Contact                      │
│     In CRM system                       │
│                                         │
│  📊 Update Analytics                    │
│     Track conversion                    │
│                                         │
└─────────────────────────────────────────┘
```

**How it's stored:**
```json
{
  "name": "Email Admin on Submit",
  "trigger_event": "form_submitted",
  "enabled": true,
  "actions": [
    {
      "type": "send_email",
      "to": "admin@company.com",
      "subject": "New form submission"
    }
  ]
}
```

---

## 🎨 Theme Customization

Make the form match your brand:

```
┌─────────────────────────────────────────┐
│           FORM APPEARANCE               │
├─────────────────────────────────────────┤
│                                         │
│  Colors                                 │
│  ├─ Accent:      [🎨 #2563EB]          │
│  └─ Background:  [🎨 #FFFFFF]          │
│                                         │
│  Typography                             │
│  ├─ Font:        Inter                  │
│  ├─ Size:        16px                   │
│  └─ Weight:      400 (Normal)           │
│                                         │
│  Layout                                 │
│  ├─ Radius:      6px (rounded corners)  │
│  └─ Button:      Solid style            │
│                                         │
│  Mode                                   │
│  └─ Theme:       Auto (light/dark)      │
│                                         │
│  Branding                               │
│  ├─ Logo:        [Upload]               │
│  └─ Cover:       [Upload]               │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🔍 Common Queries (Visual)

### "Show me all my forms"

```sql
SELECT id, title, status 
FROM forms 
WHERE created_by = 'user-123'
ORDER BY updated_at DESC;
```

Result:
```
┌──────────┬──────────────────┬───────────┐
│ ID       │ Title            │ Status    │
├──────────┼──────────────────┼───────────┤
│ abc-123  │ Customer Survey  │ Published │
│ def-456  │ Contact Form     │ Draft     │
│ ghi-789  │ Event RSVP       │ Archived  │
└──────────┴──────────────────┴───────────┘
```

### "How many responses does this form have?"

```sql
SELECT COUNT(*) 
FROM form_submissions 
WHERE form_id = 'abc-123';
```

Result:
```
┌───────┐
│ Count │
├───────┤
│ 1,234 │
└───────┘
```

### "Show me forms with payment enabled"

```sql
SELECT id, title 
FROM forms 
WHERE settings->'payment'->>'enabled' = 'true';
```

Result:
```
┌──────────┬──────────────────────┐
│ ID       │ Title                │
├──────────┼──────────────────────┤
│ abc-123  │ Product Order Form   │
│ xyz-999  │ Membership Signup    │
└──────────┴──────────────────────┘
```

---

## 📈 Performance: Why Indexes Matter

### Without Index (Slow)
```
Database has to check EVERY row

┌─────────────────────────────────────┐
│ forms table (10,000 rows)           │
├─────────────────────────────────────┤
│ Row 1: Check slug? No               │
│ Row 2: Check slug? No               │
│ Row 3: Check slug? No               │
│ ...                                 │
│ Row 5,000: Check slug? No           │
│ ...                                 │
│ Row 9,999: Check slug? YES! ✓       │
└─────────────────────────────────────┘

⏱️ Time: 100ms
```

### With Index (Fast)
```
Index is like a book's table of contents

┌─────────────────────────────────────┐
│ Slug Index                          │
├─────────────────────────────────────┤
│ customer-survey → Row 9,999         │
│ contact-form    → Row 234           │
│ event-rsvp      → Row 5,678         │
└─────────────────────────────────────┘

✓ Look up slug in index
✓ Jump directly to row

⏱️ Time: 1ms (100x faster!)
```

---

## 🔐 Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      WHO CAN DO WHAT?                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────┬────────────────────────────────────────────────┐
│ Form Owner  │ • Create, edit, delete forms                   │
│ (Creator)   │ • View all submissions                         │
│             │ • Manage workflows                             │
│             │ • See payment data                             │
└─────────────┴────────────────────────────────────────────────┘

┌─────────────┬────────────────────────────────────────────────┐
│ Public      │ • View published forms only                    │
│ (Visitors)  │ • Submit responses (if allowed)                │
│             │ • Cannot see other submissions                 │
│             │ • Cannot edit form                             │
└─────────────┴────────────────────────────────────────────────┘

┌─────────────┬────────────────────────────────────────────────┐
│ System      │ • All queries filtered by user_id              │
│             │ • Public forms accessed via unique slug        │
│             │ • Passwords hashed                             │
│             │ • Payment credentials encrypted                │
└─────────────┴────────────────────────────────────────────────┘
```

---

## 📚 Documentation Map

```
┌─────────────────────────────────────────────────────────────────┐
│                   WHERE TO FIND INFORMATION                      │
└─────────────────────────────────────────────────────────────────┘

🎯 GETTING STARTED
   └─ docs/README.md
   └─ FORM_MODULE_SCHEMA_SUMMARY.md (you are here!)

📘 COMPLETE REFERENCE
   └─ docs/FORM_MODULE_DATABASE_SCHEMA.md
      • All table definitions
      • Complete JSONB structures
      • Security & troubleshooting

⚡ QUICK LOOKUPS
   └─ docs/FORM_SCHEMA_QUICK_REFERENCE.md
      • Common queries
      • API functions
      • Field types list

🎨 VISUAL DIAGRAMS
   └─ docs/FORM_SCHEMA_ER_DIAGRAM.md
      • Entity relationships (Mermaid)
      • State diagrams
      • Sequence flows

📐 THIS GUIDE
   └─ docs/FORM_SCHEMA_VISUAL_GUIDE.md
      • Beginner-friendly
      • Lots of diagrams
      • Plain English
```

---

## 🚀 Try It Yourself

### Create Your First Form

```typescript
// 1. Import the function
import { createWorkspaceForm } from '@/lib/forms';

// 2. Call it
const myForm = await createWorkspaceForm('user-123', {
  title: "My First Form",
  description: "Testing the system",
  fields: [
    {
      id: "field-1",
      type: "shortText",
      label: "What's your name?",
      required: true
    }
  ]
});

// 3. Check the result
console.log(myForm.id);    // abc-def-ghi
console.log(myForm.slug);  // my-first-form
console.log(myForm.status); // draft
```

### View in Database

```sql
SELECT * FROM forms WHERE id = 'abc-def-ghi';
```

You'll see:
- Your title
- Your fields array (JSONB)
- Default settings (JSONB)
- Status = 'draft'

---

## ✅ Key Takeaways

1. **Database is the boss**  
   Everything lives in PostgreSQL. No cache, no files.

2. **JSONB is flexible**  
   Complex data stored as JSON objects. Still searchable!

3. **30+ field types**  
   Rich variety from simple text to payment integration.

4. **Conditional logic**  
   Show/hide fields based on answers.

5. **Versioning built-in**  
   Edit draft while public sees stable version.

6. **Workflows automate**  
   Send emails, call webhooks automatically.

7. **Well documented**  
   4 comprehensive docs cover everything.

---

**Ready to dive deeper?** Check out the [Complete Database Schema](./FORM_MODULE_DATABASE_SCHEMA.md)!

**Need quick answers?** Use the [Quick Reference Guide](./FORM_SCHEMA_QUICK_REFERENCE.md)!

**Love diagrams?** See the [ER Diagram](./FORM_SCHEMA_ER_DIAGRAM.md)!

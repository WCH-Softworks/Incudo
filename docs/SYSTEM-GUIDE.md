# How to write a system definition

A **system definition** tells Incudo how a game works: what its characters are made of, how one is built, and what
their sheet shows. It is one text file in a format called JSON. You do not need to know how to program to write one,
but you will be editing that file by hand, so this guide walks through it slowly, one part at a time.

Everything shown here is checked: every example in this file is read by Incudo's own tests, so an example that stopped
working would stop the tests.

**Contents**

1. [Start from a file the app writes](#1-start-from-a-file-the-app-writes)
2. [JSON in six rules](#2-json-in-six-rules)
3. [A tour of the starter](#3-a-tour-of-the-starter)
4. [Formulas](#4-formulas)
5. [A worked example: Lantern](#5-a-worked-example-lantern)
6. [Content for your game](#6-content-for-your-game)
7. [Changing a shipped system instead](#7-changing-a-shipped-system-instead)
8. [When the app says no, and when it says nothing](#8-when-the-app-says-no-and-when-it-says-nothing)
9. [Help from your editor](#9-help-from-your-editor)
10. [Beyond the starter](#10-beyond-the-starter)

## 1. Start from a file the app writes

Do not start from an empty file. On the screen where you choose a game, **New system…** writes one for you. Give it a
name and choose where to start:

- **A small starter system**: three scores, a level, a Health worked out from them, traits, items, notes and a sheet.
  It builds a character with nothing else loaded. This guide grows that file into a game.
- **Changes to** a game Incudo ships: for house rules. See [section 7](#7-changing-a-shipped-system-instead).
- **A copy of** a game Incudo ships: the whole definition, yours to change. It is long (5e's is close to seven
  thousand lines), so start here only if you mean to change a great deal of it.

Incudo asks where to save the file and then adds it. From then on, the loop is:

1. Open the file in a text editor (Notepad will do; see [section 9](#9-help-from-your-editor) for a better one).
2. Change something and save.
3. In Incudo, on the screen where you choose a game, choose **Add a system…** and pick the file again. It replaces the
   old one, because it has the same `id`.
4. If something is wrong, Incudo says what and on which line ([section 8](#8-when-the-app-says-no-and-when-it-says-nothing)).

Change a little at a time and add the file after each change. When something breaks, you will know which change did it.

## 2. JSON in six rules

A JSON file is made of a few shapes:

- `{ … }` is an **object**: named values, each written `"name": value`, separated by commas.
- `[ … ]` is a **list**, its values separated by commas.
- A **string** is text in double quotes: `"Might"`. A **number** is written bare: `10`, `-2`, `0.5`. **`true`**,
  **`false`** and **`null`** are written bare too.

And six rules that catch everyone at first:

1. Names and text always use straight double quotes: `"name"`, never `'name'` or curly quotes (“name”). Word processors
   change quotes as you type, so use a text editor.
2. A comma goes **between** two entries, never after the last one.
3. There are no comments. To leave yourself a note, put it in a `"description"`.
4. `10` and `"10"` are different: the first is a number, the second is text. A field that wants a number refuses text.
5. Upper and lower case matter in most places. Stat names are the exception: `Might` and `might` are the same stat.
6. Every `{` needs its `}` and every `[` its `]`. A good editor highlights the partner of the one you are on.

Incudo names the common slips at their line, in words:

```json slip
{
  "id": "my-game",
  "name": "My Game",
}
```

```text problem
Line 3, column 20: There is a comma after the last entry, before the }. JSON does not allow one: remove it.
```

## 3. A tour of the starter

Open the file **New system…** wrote. This section goes through it from the top.

### The heading

```text
"formatVersion": 1,
"id": "my-game",
"name": "My Game",
"description": "Describe your game here. …",
"version": "0.1.0",
```

- `formatVersion` is the version of this file *format*. Leave it at `1`.
- `id` is how Incudo and every character built in your game refer to it. Lower-case letters, digits and hyphens only.
  **Do not change it once you have built characters**: a character records only this id.
- `name` and `description` are what the game's card shows when choosing a game. Write them for a player.
- `version` is yours. Raise it when you change the game, if you like; Incudo only shows it.

### Element types

```json $defs/elementType
{ "name": "Trait", "plural": "Traits", "selectable": true, "browsable": true }
```

An **element** is anything a character can have that is written down somewhere: a class, a background, a spell, a
sword, a talent. Each one has a **type**, and the system lists every type there is. `selectable` means a build step
may offer elements of this type; `browsable` means **Browse** lists the type as a category of its own. The `name` must
be spelled exactly as your content spells it, upper and lower case included ([section 6](#6-content-for-your-game)).

### Stats

```json $defs/stat
{ "name": "might", "label": "Might", "default": 10 }
```

A **stat** is a named value: a score, a bonus, a count. `name` is how formulas and content refer to it; `label` is what
the sheet prints; `default` is where it starts when nothing sets it. Names may contain spaces (`"might bonus"`).

Stats can be declared in two places. The ones at the top of the file belong to the whole game. The ones inside a kind
of character (next) belong to that kind only. The starter declares the three scores for the game and `level` and
`health` for its one kind.

A stat may carry `"signed": true`, which only changes how it is printed: `+2`, `+0`, `-1`. And it may carry a
`derive`, a formula ([section 4](#4-formulas)).

### Kinds of character

The starter has one, `"character"`. A game may have several (5e has a player character, an NPC and a legendary
creature); each has its own build steps and sheet. One of them is the `default`, the kind **New character** makes.

Every kind says how it advances, in `progression`:

```json $defs/progression
{ "kind": "level", "min": 1, "max": 10, "stat": "level" }
```

```json $defs/progression
{ "kind": "none" }
```

`level` is a level the user raises one step at a time, published as the stat `stat` names. `none` is for a game with
no advancement at all. There are two more: `rating` (a number the user types, such as a monster's challenge, with
`stat`, `min` and `max`) and `xp` (a total the user types, the same way).

`elementTypes` inside a kind lists the types that kind of character can hold. Each must be one the game declares.

### Build steps

`buildSteps` is what **Build** asks for. A step offers elements of its `types`, or holds a budget of numbers. How it
asks depends on what else it says:

```json $defs/buildStep
{ "id": "calling", "label": "Calling", "types": ["Calling"], "required": true }
```

**`required`**: choose exactly one, and the character is not finished until you have.

```json $defs/buildStep
{ "id": "traits", "label": "Traits", "types": ["Trait"], "multiple": true }
```

**`multiple`**: take any number, none included. Never blocks.

```json $defs/buildStep
{ "id": "companion", "label": "Companion", "types": ["Companion"], "pick": true }
```

**`pick`**: choose one, or skip it. Never blocks.

A step with **none of the three** offers nothing by itself: it only gathers the choices your content opens (a class
that says "choose two skills"). That is how 5e's Languages step works. If your step lists types and nothing is offered,
this is usually why.

`description` is a sentence shown under the step's label. `requires` lists steps that must be usable before this one is.

### Scores: budgets and how they are set

The starter's Scores step has a `budget`:

```json $defs/buildStep
{
  "id": "scores", "label": "Scores", "types": [], "required": true,
  "budget": { "stat": "score points", "targets": ["might", "agility", "wits"], "methods": ["entered"] }
}
```

- `targets` are the stats the step sets.
- `methods` are the ways it may set them, by the ids in the game's `generationMethods`.
- `stat` is the name of a pool of extra points, which content can add to ("this background gives one more point").
  Any name will do; it need not be declared.

A generation method has one of four shapes:

```json $defs/generationMethod
{ "id": "entered", "label": "Enter manually", "min": 3, "max": 18 }
```

**Typed**: the user enters each value, between `min` and `max`.

```json $defs/generationMethod
{ "id": "points", "label": "Spend points", "pool": 12, "min": 8, "max": 14,
  "costs": { "8": 0, "9": 1, "10": 2, "11": 3, "12": 4, "13": 5, "14": 7 } }
```

**Points**: `pool` points to spend, and `costs` says what each value costs in total (the value is written in quotes
there, because a name in JSON is always text).

```json $defs/generationMethod
{ "id": "array", "label": "Use 14, 12 and 10", "values": [14, 12, 10] }
```

**A set of values** to hand out, one to each target.

```json $defs/generationMethod
{ "id": "roll", "label": "Roll", "dice": "3d6", "count": 3 }
```

**Rolled**: `count` rolls of `dice`, handed out like a set. `"4d6dl1"` is four six-sided dice, dropping the lowest.

### Text about the character

```json $defs/characterKind
{
  "id": "character",
  "freeform": {
    "label": "About the character",
    "fields": [
      { "key": "appearance", "label": "Appearance", "multiline": true },
      { "key": "notes", "label": "Notes", "multiline": true }
    ]
  }
}
```

`freeform` declares boxes of text no rule reads: appearance, backstory, notes. Build shows them; the sheet shows what is
written in them. A `key` is how the text is stored in the character: do not rename one once characters use it.

### The sheet

```json $defs/sheetSection
{ "id": "scores", "label": "Scores", "stats": ["might", "agility", "wits"], "beside": "{stat} bonus" }
```

The sheet is a list of sections. A section shows `stats`, one row each, and lists the elements of `types` the character
holds. Every stat a section shows must be declared. Three more things a section may say:

- `beside`: a stat printed after each row's value, `{stat}` standing for the row's own stat. Above, Might prints
  `Might 15 (+2)` when `might bonus` reads 2.
- `showWhen`: show a row only when this stat is not zero, again with `{stat}`: `"{stat}"` hides rows that read 0.
- `description`: a sentence under the section's label.

## 4. Formulas

A stat with a `derive` is worked out, not typed. The formula is written as a small tree of objects rather than as
`might + level × 2`. It is longer to write, and there is never any question of what comes first: you build the order
yourself.

Each object in the tree has a `kind`:

| `kind` | what it is | written as |
|---|---|---|
| `number` | a number | `{ "kind": "number", "value": 2 }` |
| `ref` | another stat's value | `{ "kind": "ref", "stat": "might" }` |
| `binary` | two values combined, `op` one of `+` `-` `*` `/` `%` | `{ "kind": "binary", "op": "+", "left": …, "right": … }` |
| `call` | `floor`, `ceil`, `round`, `min`, `max` or `abs` of its `args` | `{ "kind": "call", "fn": "max", "args": [ …, … ] }` |
| `table` | the `values` entry at position `index` (counting from 0) | `{ "kind": "table", "index": …, "values": [0, 2, 3] }` |

`floor` rounds down, `ceil` up, `round` to the nearest. `%` is the remainder of a division.

To write a formula, first put in brackets everything that happens together, then build from the inside out. The
starter's Health is `might + (level × 2)`:

```json $defs/expr
{
  "kind": "binary", "op": "+",
  "left": { "kind": "ref", "stat": "might" },
  "right": {
    "kind": "binary", "op": "*",
    "left": { "kind": "ref", "stat": "level" },
    "right": { "kind": "number", "value": 2 }
  }
}
```

A bonus of half a score above 10, rounded down, is `floor((might − 10) ÷ 2)`:

```json $defs/expr
{
  "kind": "call", "fn": "floor",
  "args": [
    {
      "kind": "binary", "op": "/",
      "left": { "kind": "binary", "op": "-", "left": { "kind": "ref", "stat": "might" }, "right": { "kind": "number", "value": 10 } },
      "right": { "kind": "number", "value": 2 }
    }
  ]
}
```

The better of two bonuses is `max(agility bonus, wits bonus)`:

```json $defs/expr
{ "kind": "call", "fn": "max", "args": [{ "kind": "ref", "stat": "agility bonus" }, { "kind": "ref", "stat": "wits bonus" }] }
```

A number that follows a table rather than a rule, here 0 at level 1, 1 at levels 2 and 3, 2 from level 4, is a `table`
indexed by the level. The level starts at 1 and the table at 0, so the index is `level − 1`; past the end of the list,
the last entry is read:

```json $defs/expr
{
  "kind": "table",
  "index": { "kind": "binary", "op": "-", "left": { "kind": "ref", "stat": "level" }, "right": { "kind": "number", "value": 1 } },
  "values": [0, 1, 1, 2]
}
```

**A stat nothing declares reads as 0**, and content can add to it. That is deliberate: it is how a game leaves room for
what its content adds. It also means a misspelled name reads 0 instead of failing. When the misspelling is a letter or
two from a stat you did declare, Incudo warns you ([section 8](#8-when-the-app-says-no-and-when-it-says-nothing)).

Content adds to a stat after its formula: in the example below, a calling that gives Health +3 adds 3 to whatever the
formula makes.

## 5. A worked example: Lantern

Here is the starter grown into a small game, Lantern. Compared with the starter, it has:

- a third element type, `Calling`, and a required step to choose one;
- four ways to set the scores;
- a bonus for each score, shown beside it;
- a Guard of `10 + max(agility bonus, wits bonus)`.

```json system
{
  "formatVersion": 1,
  "id": "lantern",
  "name": "Lantern",
  "description": "A small game of lamplit roads: three scores, a calling, traits and what you carry.",
  "version": "0.1.0",
  "elementTypes": [
    { "name": "Calling", "plural": "Callings", "selectable": true, "browsable": true },
    { "name": "Trait", "plural": "Traits", "selectable": true, "browsable": true },
    { "name": "Item", "plural": "Items", "selectable": true, "browsable": true }
  ],
  "stats": [
    { "name": "might", "label": "Might", "default": 10 },
    { "name": "agility", "label": "Agility", "default": 10 },
    { "name": "wits", "label": "Wits", "default": 10 }
  ],
  "generationMethods": [
    { "id": "points", "label": "Spend points", "pool": 12, "min": 8, "max": 14,
      "costs": { "8": 0, "9": 1, "10": 2, "11": 3, "12": 4, "13": 5, "14": 7 } },
    { "id": "array", "label": "Use 14, 12 and 10", "values": [14, 12, 10] },
    { "id": "roll", "label": "Roll", "dice": "3d6", "count": 3 },
    { "id": "entered", "label": "Enter manually", "min": 3, "max": 18 }
  ],
  "characterKinds": [
    {
      "id": "character",
      "name": "Character",
      "description": "Someone walking the lamplit roads.",
      "default": true,
      "progression": { "kind": "level", "min": 1, "max": 10, "stat": "level" },
      "stats": [
        { "name": "level", "label": "Level", "default": 1 },
        { "name": "might bonus", "label": "Might bonus", "signed": true,
          "derive": { "kind": "call", "fn": "floor", "args": [
            { "kind": "binary", "op": "/",
              "left": { "kind": "binary", "op": "-", "left": { "kind": "ref", "stat": "might" }, "right": { "kind": "number", "value": 10 } },
              "right": { "kind": "number", "value": 2 } } ] } },
        { "name": "agility bonus", "label": "Agility bonus", "signed": true,
          "derive": { "kind": "call", "fn": "floor", "args": [
            { "kind": "binary", "op": "/",
              "left": { "kind": "binary", "op": "-", "left": { "kind": "ref", "stat": "agility" }, "right": { "kind": "number", "value": 10 } },
              "right": { "kind": "number", "value": 2 } } ] } },
        { "name": "wits bonus", "label": "Wits bonus", "signed": true,
          "derive": { "kind": "call", "fn": "floor", "args": [
            { "kind": "binary", "op": "/",
              "left": { "kind": "binary", "op": "-", "left": { "kind": "ref", "stat": "wits" }, "right": { "kind": "number", "value": 10 } },
              "right": { "kind": "number", "value": 2 } } ] } },
        { "name": "health", "label": "Health", "default": 0,
          "derive": { "kind": "binary", "op": "+",
            "left": { "kind": "ref", "stat": "might" },
            "right": { "kind": "binary", "op": "*", "left": { "kind": "ref", "stat": "level" }, "right": { "kind": "number", "value": 2 } } } },
        { "name": "guard", "label": "Guard", "default": 0,
          "derive": { "kind": "binary", "op": "+",
            "left": { "kind": "number", "value": 10 },
            "right": { "kind": "call", "fn": "max", "args": [ { "kind": "ref", "stat": "agility bonus" }, { "kind": "ref", "stat": "wits bonus" } ] } } }
      ],
      "elementTypes": ["Calling", "Trait", "Item"],
      "buildSteps": [
        { "id": "scores", "label": "Scores", "types": [], "required": true,
          "description": "Set Might, Agility and Wits by one of the methods offered.",
          "budget": { "stat": "score points", "targets": ["might", "agility", "wits"], "methods": ["points", "array", "roll", "entered"] } },
        { "id": "calling", "label": "Calling", "types": ["Calling"], "required": true },
        { "id": "traits", "label": "Traits", "types": ["Trait"], "multiple": true },
        { "id": "gear", "label": "Gear", "types": ["Item"], "multiple": true }
      ],
      "freeform": {
        "label": "About the character",
        "fields": [
          { "key": "appearance", "label": "Appearance", "multiline": true },
          { "key": "notes", "label": "Notes", "multiline": true }
        ]
      },
      "sheet": {
        "sections": [
          { "id": "scores", "label": "Scores", "stats": ["might", "agility", "wits"], "beside": "{stat} bonus" },
          { "id": "condition", "label": "Condition", "stats": ["level", "health", "guard"] },
          { "id": "calling", "label": "Calling", "types": ["Calling"] },
          { "id": "traits", "label": "Traits", "types": ["Trait"] },
          { "id": "gear", "label": "Gear", "types": ["Item"] }
        ]
      }
    }
  ]
}
```

On its own it builds a character with three scores and nothing to choose for the other steps. With the content in the
next section loaded, a character who takes 14, 12 and 10 (14 to Might, 12 to Wits), the Warden calling, the Brave
trait and a rope reads:

```text sheet
Scores: Might 15 (+2), Agility 10 (+0), Wits 12 (+1)
Condition: Level 1, Health 20, Guard 11
Calling: Warden
Traits: Brave
Gear: Rope
```

Might is 15 because Brave adds 1 to the 14 chosen. Health is `15 + 1 × 2`, plus the Warden's 3.

## 6. Content for your game

The callings, traits and items themselves are **content**, kept apart from the system so that the same game can have
many books of it. Incudo reads content in the format Aurora Builder used: an XML file of `<element>`s.

```xml content
<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Warden" type="Calling" source="Lantern" id="ID_LANTERN_CALLING_WARDEN">
    <description><p>You keep the road open. Health +3.</p></description>
    <rules>
      <stat name="health" value="3" />
    </rules>
  </element>
  <element name="Brave" type="Trait" source="Lantern" id="ID_LANTERN_TRAIT_BRAVE">
    <description><p>Not easily frightened. Might +1.</p></description>
    <rules>
      <stat name="might" value="1" />
    </rules>
  </element>
  <element name="Rope" type="Item" source="Lantern" id="ID_LANTERN_ITEM_ROPE">
    <description><p>Fifty feet of it.</p></description>
  </element>
</elements>
```

- `id` is unique across everything loaded. A prefix of your game's name keeps it so.
- `type` must be one of the system's element types, **spelled exactly**: an element of type `calling` is not a
  `Calling`, and no step will offer it. Nothing warns about this.
- `source` names the book it comes from.
- `<rules>` change the character: `<stat name="health" value="3" />` adds 3 to Health.
- `<description>` is what Incudo shows when the element is chosen or browsed.

To load it, choose your game, open **Sources**, and drop the `.xml` file on the window, or choose **Choose files…**.
Each file becomes a source of its own.

Aurora's format has much more (`<select>` for choices an element opens, `<grant>` for what it gives,
`requirements` for what it needs); [AURORA-FORMAT.md](./AURORA-FORMAT.md) describes what Incudo reads of it.

**`auroraTypeMap`** in a system definition does not translate types: Incudo uses each element's `type` as written. Its
presence says only that the game reads Aurora's own content, which matters when an Aurora Builder save is imported. A
game of your own does not need it.

## 7. Changing a shipped system instead

To change a few rules of a game Incudo ships and keep receiving its fixes, write an **overlay**: your own `id`,
`name` and `version`, `"extends"` naming the game you change, and only what differs. **New system…**'s "Changes to"
starts one. [systems/README.md](../systems/README.md#changing-a-shipped-system-an-overlay) has the rules; here is what
they mean for formulas.

An overlay merges objects name by name. That makes a small change small: this one changes only the stat Lantern's
Health starts from.

```json overlay
{
  "formatVersion": 1, "id": "lantern-wits", "name": "Lantern, by wits", "version": "0.1.0", "extends": "lantern",
  "characterKinds": [
    { "id": "character", "stats": [
      { "name": "health", "derive": { "left": { "stat": "wits" } } }
    ] }
  ]
}
```

It also means that replacing a formula with one of a different shape keeps the old one's parts, and the file is refused:

```json refused
{
  "formatVersion": 1, "id": "lantern-flat", "name": "Lantern, flat health", "version": "0.1.0", "extends": "lantern",
  "characterKinds": [
    { "id": "character", "stats": [
      { "name": "health", "derive": { "kind": "ref", "stat": "might" } }
    ] }
  ]
}
```

```text problem
In Lantern's part, which something this file changes or removes breaks: characterKinds "character" › stats "health" › derive › op: is not a known field
In Lantern's part, which something this file changes or removes breaks: characterKinds "character" › stats "health" › derive › left: is not a known field
In Lantern's part, which something this file changes or removes breaks: characterKinds "character" › stats "health" › derive › right: is not a known field
```

The problems have no line because your file does not write `op`, `left` or `right`: Lantern does, and they were kept.
Write each part the old formula had and the new one does not as `null`, which removes it:

```json overlay
{
  "formatVersion": 1, "id": "lantern-flat", "name": "Lantern, flat health", "version": "0.1.0", "extends": "lantern",
  "characterKinds": [
    { "id": "character", "stats": [
      { "name": "health", "derive": { "kind": "ref", "stat": "might", "op": null, "left": null, "right": null } }
    ] }
  ]
}
```

## 8. When the app says no, and when it says nothing

**When a file is refused**, the screen where you choose a game lists every problem, in the order they appear in the
file, each with its line and column and the path to the part that is wrong. In the path, an entry with a name is
called by its name (`stats "health"`) and `›` steps inside it.

```json refused
{
  "formatVersion": 1, "id": "lantern-text", "name": "Lantern, in words", "version": "0.1.0", "extends": "lantern",
  "characterKinds": [
    { "id": "character", "stats": [{ "name": "health", "derive": "might + level * 2" }] }
  ]
}
```

```text problem
Line 4, column 56: characterKinds "character" › stats "health" › derive: must be an object, not a string
```

The ones you are most likely to meet:

| it says | it means |
|---|---|
| `is required` | a field that must be there is missing |
| `is not a known field — did you mean "required"?` | a field's name is misspelled, or in the wrong place |
| `must be a number, not a string` | a number was written in quotes |
| `must be one of …` | only the listed values are allowed |
| `must be lowercase letters, digits and hyphens` | the system's `id` has a capital, a space or an accent |
| `… which the system's elementTypes does not declare` | a type a kind or step names is not in the game's list, or is spelled differently |
| `… shows the stat "luck", which is not declared` | a sheet section shows a stat nothing declares |
| `… offers the generation method "rolled", which … does not declare` | a step's `methods` names a method that is not in `generationMethods` |
| `"might" is already used in this stats list` | the same name twice in one list |
| `marks 2 kinds as default` | only one kind may be the default |

Problems about how parts refer to each other are only checked once the file's shape is right, so fixing the first
round can show a second.

**When a file loads but something looks wrong**, its card says so. Today that is one thing: a stat name a letter or two
from one you declared.

```json warns
{
  "formatVersion": 1, "id": "lantern-slip", "name": "Lantern, with a slip", "version": "0.1.0", "extends": "lantern",
  "characterKinds": [
    { "id": "character", "stats": [
      { "name": "health", "derive": { "left": { "stat": "mihgt" } } }
    ] }
  ]
}
```

```text problem
Line 5, column 49: characterKinds "character" › stats "health" › derive › left › stat: names "mihgt", which this system does not declare; did you mean "might"? A stat nothing declares reads as 0 unless content adds to it.
```

**And some mistakes load without a word.** Check for these when the sheet is not what you expect:

- A stat name that is not close to any you declared reads 0.
- An element whose `type` is spelled differently from the system's (`calling` for `Calling`) is never offered.
- A build step that is not `required`, `multiple` or `pick` offers nothing of its own ([section 3](#build-steps)).
- A budget target that nothing declares is set, has no label, and shows nowhere.

## 9. Help from your editor

An editor that understands **JSON Schema** can underline mistakes as you type and suggest field names. Visual Studio
Code is one, and free. Incudo's format is described by [`schemas/system.schema.json`](../schemas/system.schema.json).
Save a copy of that file beside yours and add this line at the top of your definition, after the `{`:

```text
"$schema": "./system.schema.json",
```

For an overlay, point at the overlay part of the schema instead, or the editor will ask for everything a whole game
needs:

```text
"$schema": "./system.schema.json#/$defs/overlay",
```

Incudo ignores the line. This has not been tried in every editor, and an editor's check is a help, not the judge: the
app's own check, when you add the file, is the one that counts.

## 10. Beyond the starter

The starter and Lantern use about a fifth of what the format can say. Everything else is used, so far, only by the
5e definition in [`systems/dnd5e/system.json`](../systems/dnd5e/system.json), which is long and built around a large
body of existing content. When you need one of these, find it there, and read its description in
[`schemas/system.schema.json`](../schemas/system.schema.json):

- **Kinds that build on kinds** (`extends` on a kind): 5e's legendary creature is its NPC plus a few things.
- **Rules of the kind itself**, beside content's: `contributions` (5e's armour class of 10 when nothing is worn),
  `trackStats` (once per class: hit points, spell slots), `blockStats`.
- **Levels in more than one class**: `perLevel` steps, `levelRoll`, `trackStatPattern`, `trackType`.
- **Equipment**: `inventory` (slots, attunement), `attacks`, `currency`, `equip` steps.
- **Spellcasting**: `preparation`, `blockFilters`, `setterTags`.
- **Play**: `play` (rests, trackers, conditions).
- **What a user may add or write**: `customFeatures`, `additions`, `references`.
- **Creatures a character holds**: `companions`.
- **Books**: `publication` and `requiredWhen` on an element type.
- **The sheet**: `mark`, `group`, `preparedMark`, `trackProgress`, `trackDie`, `omitHidden`, `printed`, `bag`.

The schema's descriptions mention decision records (`ADR 0062` and so on). Those are in [docs/adr](./adr/README.md),
and say why each part is shaped as it is.

If your game needs something the format cannot say, that is worth a report: the format is meant to grow when a real
game needs it.

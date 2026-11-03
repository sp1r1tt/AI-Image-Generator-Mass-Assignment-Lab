# How to Write a Custom Semgrep Rule to Detect Mass Assignment in NestJS + TypeORM

While studying Application Security, I decided to go beyond simply finding vulnerabilities in existing applications and try to automate the detection of some of them using Semgrep.

For this experiment, I used the laboratory project `AI-Image-Generator-Mass-Assignment-Lab` — an application built with NestJS and TypeORM that deliberately implements insecure ways of creating and updating users.

My goal was to write custom Semgrep rules capable of detecting potentially dangerous code patterns related to Mass Assignment.

As a result, I implemented two rules in a single `.semgrep/nestjs-mass-assignment.yml` file:

- The first searches for `Object.assign()` when updating an existing entity.
- The second checks the use of `Repository.create()` with supplied objects.

Why were exactly two rules needed, how do they work, and what results did I obtain? Let's take a closer look.

## 1. What Is Mass Assignment?

Mass Assignment occurs when an application automatically transfers data from a user request into a model or entity object without restricting the list of properties that are allowed to be modified.

Imagine that we have a user with the following fields:

```
{
  id: "123",
  username: "john",
  email: "john@example.com",
  role: "user",
  plan: "free",
  generationCredits: 5
}
```

Normally, a user should only be able to modify their name or profile settings.

However, if the server simply copies all received data into the user object, a client can attempt to submit additional properties:

```
{
  "fullName": "John Smith",
  "role": "admin",
  "plan": "pro",
  "generationCredits": 999
}
```

If the server accepts and saves these fields without proper validation, the user may be able to modify properties that should be controlled exclusively by the server.

Depending on the application's logic, this can lead to privilege escalation, access to paid features, or bypassing business restrictions.

This is why Mass Assignment falls under CWE-915 — Improperly Controlled Modification of Dynamically-Determined Object Attributes.

## 2. Exploring the Laboratory Project

The lab uses NestJS, TypeORM, and SQLite.

For the analysis, I identified three main components: Entity, Controller, and Service.

### User Entity

File: `src/users/entities/user.entity.ts`

The user has not only regular profile data but also properties that affect access to application features:

```
@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  fullName?: string;

  @Column({ type: 'json', nullable: true })
  profile: Record<string, any> = {};

  @Column({ default: 5 })
  generationCredits: number;

  @Column({ default: 'free' })
  plan: string;

  @Column({ type: 'json', nullable: true })
  features: Record<string, any> = {};

  @Column({ default: 5 })
  dailyLimit: number;

  @CreateDateColumn()
  createdAt: Date;
}
```

Pay particular attention to:

- `plan` — the user's subscription plan.
- `generationCredits` — the number of available generations.
- `features` — additional account capabilities.
- `dailyLimit` — the daily usage limit.

If a client can modify these fields, they may potentially gain access to features that should only be available to paying users.

### Controller

File: `src/users/users.controller.ts`

The controller receives HTTP requests and passes the data to the service.

For example, user registration:

```
@Post('register')
async register(@Body() dto: CreateUserDto) {
  const existing = await this.usersService.findByEmail(dto.email);

  if (existing) {
    throw new BadRequestException('Email already taken');
  }

  const user = await this.usersService.create(dto);
  const tokenData = await this.authService.generateToken(user);

  return {
    message: 'Registered',
    user: await this.usersService.findById(user.id),
    access_token: tokenData.access_token,
  };
}
```

Profile updates are implemented as follows:

```
@Put(':id/flat')
async updateFlat(
  @Param('id') id: string,
  @Body() body: any,
  @Req() req
) {
  return this.usersService.updateFlat(
    id,
    body,
    req.user.userId
  );
}
```

Here, we can notice a potentially interesting detail: the request body has the `any` type.

This alone does not prove that a vulnerability exists, but it means that TypeScript does not restrict the structure of the input data at compile time.

### Service: Where the Problem Exists

File: `src/users/users.service.ts`

When creating a user, the following code is used:

```
async create(data: any): Promise<User> {
  const user = this.repo.create(data as Partial<User>);

  return this.repo.save(user);
}
```

When updating a user:

```
async updateFlat(
  id: string,
  raw: any,
  requesterId: string
): Promise<any> {
  const user = await this.repo.findOneBy({ id });

  if (!user || user.id !== requesterId) {
    throw new UnauthorizedException();
  }

  Object.assign(user, raw);

  await this.repo.save(user);

  return this.findById(id);
}
```

Similar logic is also used in `updateFull()`.

There are two constructions that are particularly interesting to us:

1. `this.repo.create(data)` — creates an entity from a supplied object.
2. `Object.assign(user, raw)` — copies properties from an input object into an existing entity.

An important detail: the `user.id === requesterId` check protects against modifying someone else's record, but it does not restrict the fields a user can modify in their own record.

In other words, authorization and Mass Assignment protection solve different problems.

## 3. Creating Two Semgrep Rules

I decided to start with simple structural rules that search for suspicious code patterns.

Why exactly two?

In TypeORM, Mass Assignment can occur during two different operations:

- Creating a new entity from an input object using `Repository.create()`.
- Updating an existing entity by copying properties in bulk using `Object.assign()`.

These are different constructions, so a separate rule was created for each of them.

This approach makes it possible to independently search for potentially dangerous locations when creating and updating records.

File: `.semgrep/nestjs-mass-assignment.yml`

### Rule #1: Object.assign() When Updating an Entity

```
rules:
  - id: nestjs-mass-assignment-object-assign
    languages:
      - typescript
    severity: WARNING
    message: >
      Potential Mass Assignment: Object.assign copies an input object
      into an existing object. Verify that the input is validated and
      restricted to explicitly allowed properties.
    metadata:
      category: security
      cwe: CWE-915
      technology:
        - nestjs
        - typeorm

    patterns:
      - pattern: Object.assign($ENTITY, $INPUT)
      - pattern-inside: |
          $METHOD(...) {
            ...
            const $ENTITY = await $REPO.findOne$X(...);
            ...
            Object.assign($ENTITY, $INPUT);
            ...
            await $REPO.save($ENTITY);
            ...
          }
```

The purpose of the first rule is to find a situation in which the application:

1. Loads an existing record from the database.
2. Copies data from another object into it.
3. Saves the modified record.

Let's look at the main elements.

**`pattern`**

```
- pattern: Object.assign($ENTITY, $INPUT)
```

Searches for an `Object.assign()` call.

`$ENTITY` and `$INPUT` are Semgrep metavariables. They allow different variable names to be matched rather than restricting the search to specific names such as `user` and `raw`.

For example, the rule can search for:

```
Object.assign(user, raw);
Object.assign(account, body);
Object.assign(profile, dto);
```

**`pattern-inside`**

```
- pattern-inside: |
    $METHOD(...) {
      ...
      const $ENTITY = await $REPO.findOne$X(...);
      ...
      Object.assign($ENTITY, $INPUT);
      ...
      await $REPO.save($ENTITY);
      ...
    }
```

Adds additional context. It requires the detected `Object.assign()` call to be located inside a method that matches the specified structure.

Additional metavariables are used here:

- `$METHOD` — the method containing the construction.
- `$REPO` — the repository object.
- `$ENTITY` — the loaded entity.
- `$INPUT` — the object containing the data being copied.
- `$X` — a metavariable used in an attempt to match the continuation of the lookup method name.

The `...` operator allows intermediate code elements to be skipped.

**How does `patterns` work?**

Multiple conditions inside the `patterns` block are combined using AND (logical AND).

This means that Semgrep must find both an `Object.assign()` call and the corresponding context involving loading an entity from the repository and saving it.

Semgrep matches code using an AST (Abstract Syntax Tree), rather than relying on line positions.

However, `pattern-inside` is not a full data-flow analysis: it searches for a specified code structure rather than proving that `$INPUT` contains data originating from an HTTP request.

### Rule #2: Repository.create()

The second rule is designed to detect potentially dangerous usage of TypeORM's `Repository.create()`.

```
  - id: nestjs-mass-assignment-repository-create
    languages:
      - typescript
    severity: WARNING
    message: >
      Potential Mass Assignment: Repository.create receives an input
      object. Verify that privileged properties are excluded.
    metadata:
      category: security
      cwe: CWE-915
      technology:
        - nestjs
        - typeorm

    patterns:
      - pattern: $REPO.create($INPUT)
      - metavariable-regex:
          metavariable: $REPO
          regex: (?i).*(repo|repository).*
```

Unlike the first rule, this one does not require searching for an existing entity and its subsequent update. We are interested directly in creating a new entity from a supplied object.

**`pattern`**

```
- pattern: $REPO.create($INPUT)
```

Semgrep searches for a `create()` call on an object whose name matches the `$REPO` metavariable.

For example:

```
this.repo.create(data);

this.userRepository.create(dto);

userRepository.create(body);
```

**`metavariable-regex`**

```
- metavariable-regex:
    metavariable: $REPO
    regex: (?i).*(repo|repository).*
```

An additional filter is introduced here.

In NestJS and TypeORM, there are many methods named `create()`. For example:

```
NestFactory.create(AppModule);

this.usersService.create(dto);

this.repo.create(data);
```

If we use only the first pattern, the rule will search for various `create()` calls that are not necessarily related to TypeORM.

Therefore, a regular expression is used to check the object's name:

- `(?i)` — case-insensitive matching.
- `.*` — any characters before or after the match.
- `(repo|repository)` — the presence of one of the specified substrings.

Thus, the rule focuses on object names containing `repo` or `repository`.

It detects:

```
this.repo.create(data);
this.userRepository.create(dto);
```

And does not detect:

```
NestFactory.create(AppModule);

this.usersService.create(dto);
```

It is important to understand that this is filtering based on the object's name, not proof that the object is actually an instance of a TypeORM Repository.

**Why isn't `Object.assign()` used for this rule?**

Because `Repository.create()` serves a different purpose.

In TypeORM:

- `create()` creates an entity instance in memory and transfers the supplied properties into it. By itself, it does not execute an INSERT into the database.
- `save()` persists the entity in the database. Depending on its state, this may result in an INSERT or UPDATE.

The problem occurs when properties that the user should not control are copied into the entity being created, and that entity is subsequently saved using `save()`.

## 4. Testing the Rules Against the Laboratory Project

After creating the YAML file, I ran the scan:

```
semgrep scan --config .semgrep/nestjs-mass-assignment.yml ./src
```

### Scenario A: Updating a User

In `updateFlat()` and `updateFull()`, the following code is used:

```
Object.assign(user, raw);

await this.repo.save(user);
```

If a client sends:

```
{
  "plan": "pro",
  "generationCredits": 999,
  "features": {
    "unlimitedGenerations": true
  }
}
```

these properties will be copied into the user object.

In the absence of additional restrictions, this implementation allows privileged fields to be modified.

The first rule is specifically designed to detect this type of construction.

### Scenario B: User Registration

In `UsersService.create()`:

```
const user = this.repo.create(data as Partial<User>);

return this.repo.save(user);
```

Here, TypeORM's `Repository.create()` is used.

If `data` contains unprocessed data from the request body, a user may attempt to submit properties that should not be configurable during registration:

```
{
  "username": "test",
  "email": "test@example.com",
  "password": "password123",
  "plan": "pro",
  "features": {
    "unlimitedGenerations": true
  }
}
```

The type assertion:

```
data as Partial<User>
```

does not validate the object at runtime. It only tells the compiler how to interpret that type.

## 5. Scan Results

After running Semgrep, the following result was obtained:

```
┌────────────────┐
│ 1 Code Finding │
└────────────────┘

src/users/users.service.ts

nestjs-mass-assignment-repository-create

Potential Mass Assignment: Repository.create receives an input
object. Verify that privileged properties are excluded.

17┆ const user = this.repo.create(data as Partial<User>);

┌──────────────┐
│ Scan Summary │
└──────────────┘

Scan completed successfully.
Findings: 1 (1 blocking)
Rules run: 2
Targets scanned: 17
Parsed lines: ~100.0%
Scan was limited to files tracked by git
```

As a result, one match was detected — `this.repo.create(data)` in `UsersService.create()`.

The `Blocking` label does not mean that the vulnerability is critical or already exploitable. It is a characteristic of how the finding is classified in the report, not an assessment of its actual severity.

As for the first rule, `nestjs-mass-assignment-object-assign`, it did not appear in this scan.

Although `updateFlat()` and `updateFull()` contain the following construction:

```
const user = await this.repo.findOneBy({ id });

Object.assign(user, raw);

await this.repo.save(user);
```

which matches the intended detection logic, no actual finding was produced.

This is an important experimental result: the presence of a visually matching construction does not guarantee that a Semgrep structural pattern will successfully match it.

In particular, the `findOne$X` notation requires additional verification: `$X` is a Semgrep metavariable, not a regular expression for matching an arbitrary suffix of a method name. To reliably match different TypeORM methods, it is better to use separate alternatives through `pattern-either`.

Therefore, the first rule requires further improvements and retesting before it can be considered functional.

## 6. What Can Be Improved?

The resulting rules are a first step toward automating Mass Assignment detection, but they have limitations.

### 1. Checking Safe Update Approaches

Instead of:

```
Object.assign(user, raw);
```

we can explicitly list the fields that are allowed to be modified:

```
user.fullName = raw.fullName;

user.profile = {
  ...user.profile,
  bio: raw.profile?.bio,
  website: raw.profile?.website
};

await this.repo.save(user);
```

Another option is to validate the data using Zod or `class-validator` with a strict allowlist.

For NestJS with `ValidationPipe`, it is worth checking the `whitelist: true` and, where necessary, `forbidNonWhitelisted: true` settings separately.

The mere presence of a DTO does not guarantee that additional properties will be rejected or removed.

### 2. Accounting for Other Ways of Assigning Properties

The laboratory also contains another interesting example:

```
if (raw.features) {
  user.features = { ...user.features, ...raw.features };
}
```

`Object.assign()` is not used here, but input properties are still copied into the user object.

Therefore, the absence of a match by the first rule does not mean that no potential issue exists.

This demonstrates a limitation of the selected approach: structural rules detect specific constructions, but not every possible way of implementing Mass Assignment.

### 3. Adding Tests for the Rules

To understand whether a rule works correctly, it is worth creating separate test cases with expected matches and cases that should not be detected.

Semgrep supports testing through comments:

```
// ruleid: nestjs-mass-assignment-repository-create
this.repo.create(data);

// ok: nestjs-mass-assignment-repository-create
this.usersService.create(dto);
```

After that, we can run:

```
semgrep --test --config .semgrep/nestjs-mass-assignment.yml tests/
```

This makes it easier to track false positives and situations where a rule stops detecting the required code.

## Conclusion

During this experiment, I created two custom Semgrep rules to detect code patterns associated with Mass Assignment in NestJS + TypeORM.

- `nestjs-mass-assignment-object-assign` is designed to detect bulk property copying into an existing entity through `Object.assign()`.
- `nestjs-mass-assignment-repository-create` searches for the use of `Repository.create()` with a supplied object.

As a result of the scan, the second rule detected a match in `UsersService.create()` — user creation through `this.repo.create(data)`.

The first rule did not detect the expected match in its current implementation and requires further improvements.

This experiment demonstrated that Semgrep makes it possible to create custom rules for detecting specific code patterns associated with certain vulnerability classes.

However, detecting a suspicious pattern does not prove that an exploitable vulnerability exists. To confirm Mass Assignment, it is necessary to verify where the data originates, which properties are allowed to be modified, and what restrictions are applied before the entity is saved.
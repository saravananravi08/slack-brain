# Gist - Slack AI Bot

An intelligent Slack bot powered by Claude CLI that acts as the team's knowledge base, proactively engages with the channel, and generates daily/weekly digests.

## Features

- **@mention and DM handling** - Ask questions about channel history, past decisions, or anything shared in Slack
- **Proactive nudges** - Engagement prompts when the channel is quiet
- **Daily digest** - End-of-day summary of team activity (runs at 4AM IST)
- **Morning greeting** - Start the day with a fun team update (runs at 9AM IST weekdays)
- **EOD highlights** - Quick end-of-day summary (runs at 5:30PM IST weekdays)
- **Thread context** - Maintains conversation context in threads for continuous discussions
- **SQLite FTS5 search** - Fast full-text search across all channel messages
- **ClickUp integration** - Fetches task details when links are shared

## Setup

### Prerequisites

- Node.js 18+ (or use nvm)
- Claude CLI (`npm install -g @anthropic-ai/claude`)
- A Slack app with Bot Token

### Installation

```bash
git clone <repo-url> slack-brain
cd slack-brain
npm install
```

### Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your credentials in `.env`:
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CHANNEL_ID=your-channel-id
CLAUDE_API_KEY=your-claude-api-key
DATABASE_PATH=./slack_messages.db
MODEL=sonnet
```

### Deploy to EC2

```bash
./deploy.sh
```

## Usage

### Start locally

```bash
npm run bot    # Start the Slack bot
npm run cron   # Start message ingestion
```

### Search commands

```
/search <query>           - Search channel messages
/summary <YYYY-MM-DD>     - Get all messages for a date
/user <name>              - Get messages by user
/thread <thread_ts>       - Get thread messages
/stats                    - Channel statistics
```

## Architecture

- **bot.ts** - Main Slack bot with Socket Mode, handles @mentions and DMs
- **agent.ts** - Claude CLI wrapper with process management
- **proactive.ts** - Scheduled nudges, digests, and morning greetings
- **cron.ts** - Ingests new messages from Slack into SQLite
- **db.ts** - SQLite FTS5 database for message storage
- **search.ts** - Search interface for the database
- **clickup.ts** - ClickUp API integration for task details

## Scheduler

| Time (IST) | Action |
|------------|--------|
| 4:00 AM | Daily digest (weekdays) |
| 9:00 AM | Morning greeting (weekdays) |
| 5:30 PM | EOD highlights (weekdays) |
| 15 min silence | Engagement nudge |

## License

MIT
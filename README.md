# Draftly Server

AI-powered email assistant backend server.

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm
- MongoDB
- Redis
- (Optional) Python for advanced pre-commit hooks

### Installation

1. Clone this repository:
   ```
   git clone https://github.com/harry-urek/draftly-be.git
   cd draftly-be
   ```

2. Set up Firebase (required for authentication):
   ```
   See docs/firebase-setup.md for detailed instructions
   ```
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up environment variables:
   ```
   cp .env.example .env
   ```
   Edit the `.env` file with your configuration.

4. Generate Prisma client:
   ```
   npm run db:generate
   ```

5. Set up pre-commit hooks:
   ```
   npm run hooks:setup
   ```
   
### Development

- Run the development server:
  ```
  npm run dev
  ```

- Run tests:
  ```
  npm test
  ```

- Lint and format code:
  ```
  npm run lint
  npm run format
  ```

## Git Workflow

This repository uses three main branches:

- `dev`: Development branch for ongoing work
- `staging`: Pre-production testing branch
- `main`: Production-ready code

### Branch Strategy

1. Create feature branches from `dev` branch:
   ```
   git checkout -b feature/your-feature-name dev
   ```

2. Make your changes and commit with meaningful messages:
   ```
   git commit -m "feat: add new feature"
   ```

3. Push to your feature branch and create a pull request to `dev`:
   ```
   git push origin feature/your-feature-name
   ```

4. After review and testing in `dev`, promote to `staging` for integration testing.

5. Once verified in staging, promote to `main` for production deployment.

### Pre-commit Hooks

This project uses pre-commit hooks to ensure code quality. The hooks automatically:

- Format code with Prettier
- Fix linting issues with ESLint
- Run type checking with TypeScript
- Run relevant tests for changed files
- Validate Prisma schema

If you're using Python, advanced hooks are available:
```
pip install pre-commit
pre-commit install
```

## CI/CD Pipeline

This project uses GitHub Actions for CI/CD:

- **CI**: Runs on all branches to verify code quality, tests, and build
- **CD**: Deploys automatically to corresponding environments based on branch:
  - `dev` → Development environment
  - `staging` → Staging environment
  - `main` → Production environment (with manual approval)

## Deployment

The application is containerized with Docker and can be deployed using the provided Docker Compose configuration.

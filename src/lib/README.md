# Library Modules (Deprecated)

This folder contains utility functions and modules used directly in the legacy codebase. 
Most of these modules are being migrated to a proper layered architecture.

## Migration Status

| Old Module | New Implementation | Status |
|------------|-------------------|--------|
| gmail.ts | GmailIntegration + EmailService | In Progress |
| vertexai.ts | VertexAIIntegration | In Progress |
| prisma.ts | Database repositories | In Progress |
| cache.ts | CacheService | Pending |
| firebase.ts | FirebaseIntegration | Pending |
| slack.ts | SlackIntegration | Pending |
| background.ts | BackgroundService | Pending |

## Migration Strategy

1. Create proper integrations for external services
2. Create services that use these integrations
3. Create controllers that use these services
4. Update routes to use controllers
5. Remove old modules once all references are migrated

## Directory Structure

The new layered architecture follows this structure:

- `controllers/` - Handle HTTP requests and responses
- `services/` - Implement business logic and orchestration
- `repositories/` - Handle data access and persistence
- `integrations/` - Integrate with external services
- `utils/` - General utility functions
- `types/` - TypeScript type definitions
- `config/` - Application configuration

import { VoiceIntentBuilder } from '../builders/VoiceIntentBuilder';
import { IntentCategory, ParameterType } from '../types/VoiceAssistant.types';

describe('VoiceIntentBuilder', () => {
  describe('Intent Creation', () => {
    it('should create a basic intent with required fields', () => {
      const intent = VoiceIntentBuilder
        .create()
        .withId('test-intent')
        .withCategory(IntentCategory.SEARCH)
        .withHandler({
          handle: async (params) => ({ success: true })
        })
        .build();

      expect(intent.id).toBe('test-intent');
      expect(intent.category).toBe(IntentCategory.SEARCH);
      expect(intent.handler).toBeDefined();
      expect(intent.parameters).toEqual([]);
    });

    it('should throw error when building without ID', () => {
      expect(() => {
        VoiceIntentBuilder
          .create()
          .withCategory(IntentCategory.SEARCH)
          .withHandler({ handle: async () => ({}) })
          .build();
      }).toThrow('Intent ID is required');
    });

    it('should throw error when building without handler', () => {
      expect(() => {
        VoiceIntentBuilder
          .create()
          .withId('test')
          .withCategory(IntentCategory.SEARCH)
          .build();
      }).toThrow('Intent handler is required');
    });
  });

  describe('Parameter Configuration', () => {
    it('should add required parameters with correct types', () => {
      const intent = VoiceIntentBuilder
        .create<{ query: string; limit: number }>()
        .withId('search-intent')
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter('query', {
          type: ParameterType.STRING,
          prompt: 'What would you like to search for?'
        })
        .requiredParameter('limit', {
          type: ParameterType.NUMBER,
          defaultValue: 10
        })
        .withHandler({
          handle: async (params) => {
            expect(params.query).toBeDefined();
            expect(params.limit).toBeDefined();
            return { results: [] };
          }
        })
        .build();

      expect(intent.parameters).toHaveLength(2);
      expect(intent.parameters[0]).toMatchObject({
        name: 'query',
        type: ParameterType.STRING,
        required: true,
        prompt: 'What would you like to search for?'
      });
      expect(intent.parameters[1]).toMatchObject({
        name: 'limit',
        type: ParameterType.NUMBER,
        required: true,
        defaultValue: 10
      });
    });

    it('should add optional parameters', () => {
      const intent = VoiceIntentBuilder
        .create<{ query: string; filters?: Record<string, any> }>()
        .withId('search-intent')
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter('query', { type: ParameterType.STRING })
        .optionalParameter('filters', { type: ParameterType.OBJECT })
        .withHandler({
          handle: async (params) => ({ results: [] })
        })
        .build();

      expect(intent.parameters[1]).toMatchObject({
        name: 'filters',
        type: ParameterType.OBJECT,
        required: false
      });
    });

    it('should support enum parameters with choices', () => {
      const intent = VoiceIntentBuilder
        .create<{ action: 'add' | 'remove' | 'update' }>()
        .withId('todo-intent')
        .withCategory(IntentCategory.PRODUCTIVITY)
        .requiredParameter('action', {
          type: ParameterType.ENUM,
          choices: ['add', 'remove', 'update']
        })
        .withHandler({
          handle: async (params) => ({ success: true })
        })
        .build();

      expect(intent.parameters[0]).toMatchObject({
        name: 'action',
        type: ParameterType.ENUM,
        choices: ['add', 'remove', 'update'],
        required: true
      });
    });
  });

  describe('Platform Configuration', () => {
    it('should configure iOS specific settings', () => {
      const intent = VoiceIntentBuilder
        .create()
        .withId('workout-intent')
        .withCategory(IntentCategory.HEALTH)
        .configureIOS(ios => ios
          .withHealthKitIntegration()
          .addSiriPhrase('Start my workout')
          .addSiriPhrase('Begin exercise')
          .requiresUnlock()
        )
        .withHandler({ handle: async () => ({}) })
        .build();

      expect(intent.platforms.ios).toMatchObject({
        siriKitDomain: 'INWorkoutsDomain',
        phrases: ['Start my workout', 'Begin exercise'],
        requiresUnlock: true
      });
    });

    it('should configure Android specific settings', () => {
      const intent = VoiceIntentBuilder
        .create()
        .withId('exercise-intent')
        .withCategory(IntentCategory.HEALTH)
        .configureAndroid(android => android
          .withBiiCategory('Health & Fitness')
          .withCapability('actions.intent.START_EXERCISE')
          .addParameter({ name: 'exercise', key: 'exerciseType' })
          .withDeferredFulfillment()
        )
        .withHandler({ handle: async () => ({}) })
        .build();

      expect(intent.platforms.android).toMatchObject({
        biiCategory: 'Health & Fitness',
        capability: 'actions.intent.START_EXERCISE',
        parameters: [{ name: 'exercise', key: 'exerciseType' }],
        fulfillment: 'DEFERRED'
      });
    });
  });

  describe('Handler Configuration', () => {
    it('should support resolver for parameter disambiguation', () => {
      const intent = VoiceIntentBuilder
        .create<{ query: string }>()
        .withId('search-intent')
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter('query', { type: ParameterType.STRING })
        .withHandler({
          resolve: async (params) => {
            if (!params.query) {
              return { needsValue: 'query' };
            }
            return params as { query: string };
          },
          handle: async (params) => ({ results: [`Result for ${params.query}`] })
        })
        .build();

      expect(intent.handler.resolve).toBeDefined();
      expect(intent.handler.handle).toBeDefined();
    });

    it('should support error handler', () => {
      const intent = VoiceIntentBuilder
        .create()
        .withId('test-intent')
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({
          handle: async () => { throw new Error('Test error'); },
          onError: async (error) => ({ fallback: 'Error handled' })
        })
        .build();

      expect(intent.handler.onError).toBeDefined();
    });
  });

  describe('Fluent Builder Methods', () => {
    it('should support background execution configuration', () => {
      const intent = VoiceIntentBuilder
        .create()
        .withId('media-intent')
        .withCategory(IntentCategory.MEDIA)
        .withHandler({ handle: async () => ({}) })
        .withBackgroundExecution()
        .build();

      expect(intent.platforms.ios?.requiresUnlock).toBe(false);
      expect(intent.platforms.android?.fulfillment).toBe('DEFERRED');
    });

    it('should support media session integration', () => {
      const intent = VoiceIntentBuilder
        .create()
        .withId('play-intent')
        .withCategory(IntentCategory.MEDIA)
        .withHandler({ handle: async () => ({}) })
        .withMediaSessionIntegration()
        .build();

      expect(intent.platforms.ios?.siriKitDomain).toBe('INPlayMediaIntent');
      expect(intent.platforms.android?.capability).toBe('actions.intent.PLAY_MEDIA');
    });
  });

  describe('Type Safety', () => {
    it('should enforce parameter types through generics', () => {
      interface SearchParams {
        query: string;
        limit: number;
        filters?: Record<string, any>;
      }

      const intent = VoiceIntentBuilder
        .create<SearchParams>()
        .withId('typed-search')
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter('query', { type: ParameterType.STRING })
        .requiredParameter('limit', { type: ParameterType.NUMBER })
        .optionalParameter('filters', { type: ParameterType.OBJECT })
        .withHandler({
          handle: async (params: SearchParams) => {
            const { query, limit, filters } = params;
            return { query, limit, filters };
          }
        })
        .build();

      expect(intent.parameters).toHaveLength(3);
    });
  });

  describe('Builder Chain Preservation', () => {
    it('should maintain builder chain after platform configuration', () => {
      const intent = VoiceIntentBuilder
        .create()
        .withId('chain-test')
        .withCategory(IntentCategory.CUSTOM)
        .configureIOS(ios => ios.addSiriPhrase('Test phrase'))
        .configureAndroid(android => android.withCapability('test.capability'))
        .withHandler({ handle: async () => ({}) })
        .build();

      expect(intent.platforms.ios?.phrases).toContain('Test phrase');
      expect(intent.platforms.android?.capability).toBe('test.capability');
    });

    it('should apply background execution settings through fluent methods', () => {
      const intent = VoiceIntentBuilder
        .create()
        .withId('background-test')
        .withCategory(IntentCategory.MEDIA)
        .withHandler({ handle: async () => ({}) })
        .withBackgroundExecution()
        .build();

      expect(intent.platforms.ios?.requiresUnlock).toBe(false);
      expect(intent.platforms.android?.fulfillment).toBe('DEFERRED');
    });
  });
});
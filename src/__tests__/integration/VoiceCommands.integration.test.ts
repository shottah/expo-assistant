import { VoiceAssistant } from '../../VoiceAssistant';
import { VoiceIntentBuilder } from '../../builders/VoiceIntentBuilder';
import {
  IntentCategory,
  ParameterType,
  PermissionStatus
} from '../../types/VoiceAssistant.types';
import ExpoAssistantModule from '../../ExpoAssistantModule';

jest.mock('../../ExpoAssistantModule');

describe('Voice Commands Integration', () => {
  const mockModule = ExpoAssistantModule as jest.Mocked<typeof ExpoAssistantModule>;
  let voiceAssistant: VoiceAssistant;

  beforeEach(async () => {
    jest.clearAllMocks();
    (VoiceAssistant as any).instance = null;

    mockModule.initialize.mockResolvedValue(undefined);
    mockModule.registerIntent.mockResolvedValue(undefined);
    mockModule.getPlatform.mockResolvedValue('ios');
    mockModule.getLocale.mockResolvedValue('en-US');
    mockModule.addListener.mockImplementation(() => ({ remove: () => {} }));
    mockModule.checkCapabilities.mockResolvedValue({
      ios: {
        siriKitSupported: true,
        appIntentsSupported: true,
        availableDomains: ['INSearchForMessagesIntent', 'INPlayMediaIntent'],
        speechRecognitionAvailable: true
      }
    });

    voiceAssistant = await VoiceAssistant.initialize({
      debugMode: true,
      enableBackgroundExecution: true
    });
  });

  describe('Search Voice Commands', () => {
    it('should implement complete search flow with voice commands', async () => {
      const searchService = {
        execute: jest.fn().mockResolvedValue([
          { id: 1, title: 'Result 1' },
          { id: 2, title: 'Result 2' }
        ])
      };

      const searchIntent = VoiceIntentBuilder
        .create<{ query: string; filters?: { category?: string } }>()
        .withId('search-products')
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter('query', {
          type: ParameterType.STRING,
          prompt: 'What would you like to search for?'
        })
        .optionalParameter('filters', {
          type: ParameterType.OBJECT,
          parser: (value) => {
            if (typeof value === 'string') {
              return { category: value };
            }
            return value;
          }
        })
        .withHandler({
          resolve: async (params) => {
            if (!params.query) {
              return { needsValue: 'query' };
            }
            return params as any;
          },
          handle: async (params, context) => {
            const results = await searchService.execute(params);
            return {
              success: true,
              data: results,
              message: `Found ${results.length} results for "${params.query}"`
            };
          }
        })
        .configureIOS(ios => ios
          .addSiriPhrase('Search for $(query) in $(appName)')
          .addSiriPhrase('Find $(query)')
        )
        .build();

      await voiceAssistant.registerIntent(searchIntent);

      const result = await voiceAssistant.executeIntent('search-products', {
        query: 'laptop',
        filters: { category: 'electronics' }
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        success: true,
        data: [
          { id: 1, title: 'Result 1' },
          { id: 2, title: 'Result 2' }
        ],
        message: 'Found 2 results for "laptop"'
      });

      expect(searchService.execute).toHaveBeenCalledWith({
        query: 'laptop',
        filters: { category: 'electronics' }
      });
    });

    it('should handle disambiguation when parameters are missing', async () => {
      const searchIntent = VoiceIntentBuilder
        .create<{ query: string; sortBy?: 'relevance' | 'date' }>()
        .withId('smart-search')
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter('query', {
          type: ParameterType.STRING,
          prompt: 'What are you looking for?'
        })
        .optionalParameter('sortBy', {
          type: ParameterType.ENUM,
          choices: ['relevance', 'date'],
          defaultValue: 'relevance'
        })
        .withHandler({
          resolve: async (params) => {
            if (!params.query) {
              return { needsValue: 'query' };
            }
            return {
              query: params.query,
              sortBy: params.sortBy || 'relevance'
            };
          },
          handle: async (params) => ({ results: [], query: params })
        })
        .build();

      await voiceAssistant.registerIntent(searchIntent);

      const missingParamResult = await voiceAssistant.executeIntent('smart-search', {});

      expect(missingParamResult).toEqual({
        success: false,
        needsDisambiguation: true,
        message: 'Need value for: query'
      });

      const completeResult = await voiceAssistant.executeIntent('smart-search', {
        query: 'test query'
      });

      expect(completeResult.success).toBe(true);
      expect(completeResult.data).toEqual({
        results: [],
        query: { query: 'test query', sortBy: 'relevance' }
      });
    });
  });

  describe('Media Control Voice Commands', () => {
    it('should implement media playback controls', async () => {
      const mediaService = {
        play: jest.fn().mockResolvedValue({ status: 'playing' }),
        pause: jest.fn().mockResolvedValue({ status: 'paused' }),
        skip: jest.fn().mockResolvedValue({ status: 'skipped' })
      };

      const createMediaIntent = (action: 'play' | 'pause' | 'skip') => {
        return VoiceIntentBuilder
          .create<{ trackName?: string }>()
          .withId(`media-${action}`)
          .withCategory(IntentCategory.MEDIA)
          .optionalParameter('trackName', {
            type: ParameterType.STRING
          })
          .withHandler({
            handle: async (params) => {
              switch (action) {
                case 'play':
                  return await mediaService.play(params.trackName);
                case 'pause':
                  return await mediaService.pause();
                case 'skip':
                  return await mediaService.skip();
                default:
                  throw new Error('Unknown action');
              }
            }
          })
          .withBackgroundExecution()
          .withMediaSessionIntegration()
          .build();
      };

      const mediaIntents = [
        createMediaIntent('play'),
        createMediaIntent('pause'),
        createMediaIntent('skip')
      ];

      await voiceAssistant.registerIntents(mediaIntents);

      const playResult = await voiceAssistant.executeIntent('media-play', {
        trackName: 'Favorite Song'
      });
      expect(playResult.data).toEqual({ status: 'playing' });
      expect(mediaService.play).toHaveBeenCalledWith('Favorite Song');

      const pauseResult = await voiceAssistant.executeIntent('media-pause', {});
      expect(pauseResult.data).toEqual({ status: 'paused' });

      const skipResult = await voiceAssistant.executeIntent('media-skip', {});
      expect(skipResult.data).toEqual({ status: 'skipped' });
    });
  });

  describe('Todo List Voice Commands', () => {
    it('should handle todo list operations', async () => {
      const todos: Array<{ id: number; text: string; completed: boolean }> = [];
      let nextId = 1;

      const todoService = {
        add: jest.fn().mockImplementation((text: string) => {
          const todo = { id: nextId++, text, completed: false };
          todos.push(todo);
          return Promise.resolve(todo);
        }),
        complete: jest.fn().mockImplementation((text: string) => {
          const todo = todos.find(t => t.text.includes(text));
          if (todo) {
            todo.completed = true;
            return Promise.resolve(todo);
          }
          return Promise.reject(new Error('Todo not found'));
        }),
        delete: jest.fn().mockImplementation((text: string) => {
          const index = todos.findIndex(t => t.text.includes(text));
          if (index > -1) {
            const deleted = todos.splice(index, 1)[0];
            return Promise.resolve(deleted);
          }
          return Promise.reject(new Error('Todo not found'));
        }),
        list: jest.fn().mockImplementation(() => Promise.resolve(todos))
      };

      const todoIntent = VoiceIntentBuilder
        .create<{ action: 'add' | 'complete' | 'delete' | 'list'; item?: string }>()
        .withId('todo-manager')
        .withCategory(IntentCategory.PRODUCTIVITY)
        .requiredParameter('action', {
          type: ParameterType.ENUM,
          choices: ['add', 'complete', 'delete', 'list']
        })
        .optionalParameter('item', {
          type: ParameterType.STRING,
          prompt: 'Which item?'
        })
        .withHandler({
          resolve: async (params) => {
            if (params.action !== 'list' && !params.item) {
              return { needsValue: 'item' };
            }
            return params as any;
          },
          handle: async ({ action, item }) => {
            try {
              switch (action) {
                case 'add':
                  return await todoService.add(item!);
                case 'complete':
                  return await todoService.complete(item!);
                case 'delete':
                  return await todoService.delete(item!);
                case 'list':
                  return await todoService.list();
                default:
                  throw new Error('Unknown action');
              }
            } catch (error) {
              return {
                success: false,
                error: (error as Error).message
              };
            }
          },
          onError: async (error) => ({
            success: false,
            message: `Failed to perform todo action: ${error.message}`
          })
        })
        .configureIOS(ios => ios
          .addSiriPhrase('Add $(item) to my todo list')
          .addSiriPhrase('Mark $(item) as done')
          .addSiriPhrase('Remove $(item) from my list')
        )
        .build();

      await voiceAssistant.registerIntent(todoIntent);

      const addResult = await voiceAssistant.executeIntent('todo-manager', {
        action: 'add',
        item: 'Buy groceries'
      });
      expect(addResult.data).toEqual({
        id: 1,
        text: 'Buy groceries',
        completed: false
      });

      const completeResult = await voiceAssistant.executeIntent('todo-manager', {
        action: 'complete',
        item: 'groceries'
      });
      expect(completeResult.data).toEqual({
        id: 1,
        text: 'Buy groceries',
        completed: true
      });

      const listResult = await voiceAssistant.executeIntent('todo-manager', {
        action: 'list'
      });
      expect(listResult.data).toHaveLength(1);
      expect(listResult.data[0].completed).toBe(true);
    });
  });

  describe('Exercise Tracking Voice Commands', () => {
    it('should handle workout intents with health integration', async () => {
      const workoutService = {
        startWorkout: jest.fn().mockResolvedValue({
          id: 'workout-123',
          type: 'running',
          startTime: new Date()
        }),
        endWorkout: jest.fn().mockResolvedValue({
          id: 'workout-123',
          duration: 1800,
          calories: 250
        }),
        logExercise: jest.fn().mockResolvedValue({ success: true })
      };

      const exerciseIntent = VoiceIntentBuilder
        .create<{
          action: 'start' | 'stop' | 'log';
          exerciseType?: string;
          duration?: number;
          intensity?: 'low' | 'medium' | 'high';
        }>()
        .withId('fitness-tracker')
        .withCategory(IntentCategory.HEALTH)
        .requiredParameter('action', {
          type: ParameterType.ENUM,
          choices: ['start', 'stop', 'log']
        })
        .optionalParameter('exerciseType', {
          type: ParameterType.STRING,
          defaultValue: 'workout'
        })
        .optionalParameter('duration', {
          type: ParameterType.NUMBER,
          prompt: 'For how many minutes?'
        })
        .optionalParameter('intensity', {
          type: ParameterType.ENUM,
          choices: ['low', 'medium', 'high'],
          defaultValue: 'medium'
        })
        .withHandler({
          handle: async (params) => {
            switch (params.action) {
              case 'start':
                return await workoutService.startWorkout(
                  params.exerciseType || 'workout'
                );
              case 'stop':
                return await workoutService.endWorkout();
              case 'log':
                return await workoutService.logExercise({
                  type: params.exerciseType,
                  duration: params.duration,
                  intensity: params.intensity
                });
              default:
                throw new Error('Unknown action');
            }
          }
        })
        .configureIOS(ios => ios
          .withHealthKitIntegration()
          .addSiriPhrase('Start my $(exerciseType) workout')
          .addSiriPhrase('End my workout')
          .addSiriPhrase('Log $(duration) minutes of $(exerciseType)')
        )
        .configureAndroid(android => android
          .withGoogleFitIntegration()
          .withBiiCategory('Health & Fitness')
          .withCapability('actions.intent.START_EXERCISE')
        )
        .build();

      await voiceAssistant.registerIntent(exerciseIntent);

      const startResult = await voiceAssistant.executeIntent('fitness-tracker', {
        action: 'start',
        exerciseType: 'running'
      });
      expect(startResult.data).toMatchObject({
        id: 'workout-123',
        type: 'running'
      });

      const stopResult = await voiceAssistant.executeIntent('fitness-tracker', {
        action: 'stop'
      });
      expect(stopResult.data).toMatchObject({
        duration: 1800,
        calories: 250
      });

      const logResult = await voiceAssistant.executeIntent('fitness-tracker', {
        action: 'log',
        exerciseType: 'yoga',
        duration: 30,
        intensity: 'low'
      });
      expect(logResult.data).toEqual({ success: true });
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle and recover from service failures', async () => {
      let attemptCount = 0;
      const unreliableService = {
        process: jest.fn().mockImplementation(() => {
          attemptCount++;
          if (attemptCount < 3) {
            return Promise.reject(new Error('Service temporarily unavailable'));
          }
          return Promise.resolve({ success: true, attempt: attemptCount });
        })
      };

      const resilientIntent = VoiceIntentBuilder
        .create<{ retry?: boolean }>()
        .withId('resilient-operation')
        .withCategory(IntentCategory.CUSTOM)
        .optionalParameter('retry', {
          type: ParameterType.BOOLEAN,
          defaultValue: true
        })
        .withHandler({
          handle: async (params) => {
            const maxRetries = params.retry ? 3 : 1;
            let lastError: Error | null = null;

            for (let i = 0; i < maxRetries; i++) {
              try {
                return await unreliableService.process();
              } catch (error) {
                lastError = error as Error;
                if (i < maxRetries - 1) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              }
            }

            throw lastError;
          },
          onError: async (error) => ({
            fallback: 'Service is currently unavailable. Please try again later.',
            error: error.message
          })
        })
        .build();

      await voiceAssistant.registerIntent(resilientIntent);

      attemptCount = 0;
      const result = await voiceAssistant.executeIntent('resilient-operation', {
        retry: true
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ success: true, attempt: 3 });
      expect(unreliableService.process).toHaveBeenCalledTimes(3);
    });
  });

  describe('Permission Flow', () => {
    it('should handle complete permission request flow', async () => {
      mockModule.requestMicrophonePermission
        .mockResolvedValueOnce(PermissionStatus.UNDETERMINED)
        .mockResolvedValueOnce(PermissionStatus.GRANTED);

      mockModule.requestSpeechRecognitionPermission
        .mockResolvedValueOnce(PermissionStatus.GRANTED);

      const micStatus1 = await voiceAssistant.requestMicrophonePermission();
      expect(micStatus1).toBe(PermissionStatus.UNDETERMINED);

      const micStatus2 = await voiceAssistant.requestMicrophonePermission();
      expect(micStatus2).toBe(PermissionStatus.GRANTED);

      const speechStatus = await voiceAssistant.requestSpeechRecognitionPermission();
      expect(speechStatus).toBe(PermissionStatus.GRANTED);

      const voiceIntent = VoiceIntentBuilder
        .create()
        .withId('permission-required')
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({
          handle: async (_, context) => ({
            platform: context.platform,
            locale: context.locale,
            permissionsGranted: true
          })
        })
        .build();

      await voiceAssistant.registerIntent(voiceIntent);

      const result = await voiceAssistant.executeIntent('permission-required', {});
      expect(result.data).toMatchObject({
        platform: 'ios',
        locale: 'en-US',
        permissionsGranted: true
      });
    });
  });
});
import {
  VoiceIntent,
  IntentCategory,
  VoiceParameter,
  IntentHandler,
  ParameterConfig,
  AndroidParameter,
} from "../types/VoiceAssistant.types";

export class VoiceIntentBuilder<
  TParams = {},
  TBuilt extends keyof TParams = never
> {
  private id: string = "";
  private category: IntentCategory = IntentCategory.CUSTOM;
  private parameters: VoiceParameter[] = [];
  private handler?: IntentHandler<any, any>;
  private iosConfig?: {
    siriKitDomain?: string;
    appIntentSchema?: string;
    phrases: string[];
    requiresUnlock?: boolean;
  };
  private androidConfig?: {
    biiCategory?: string;
    capability: string;
    parameters: AndroidParameter[];
    fulfillment?: "INLINE" | "DEFERRED";
  };

  static create<T = {}>(): VoiceIntentBuilder<T, never> {
    return new VoiceIntentBuilder<T, never>();
  }

  withId(id: string): this {
    this.id = id;
    return this;
  }

  withCategory<C extends IntentCategory>(category: C): this {
    this.category = category;
    return this;
  }

  parameter<K extends string, V>(
    name: K,
    config: ParameterConfig<V>
  ): VoiceIntentBuilder<TParams & Record<K, V>, TBuilt | K> {
    const parameter: VoiceParameter = {
      name,
      type: config.type,
      required: config.required,
      defaultValue: config.defaultValue,
      prompt: config.prompt,
      choices: config.choices as string[],
      parser: config.parser,
    };

    this.parameters.push(parameter);
    return this as any;
  }

  requiredParameter<K extends string, V>(
    name: K,
    config: Omit<ParameterConfig<V>, "required">
  ): VoiceIntentBuilder<TParams & Record<K, V>, TBuilt | K> {
    return this.parameter(name, { ...config, required: true });
  }

  optionalParameter<K extends string, V>(
    name: K,
    config: Omit<ParameterConfig<V>, "required">
  ): VoiceIntentBuilder<TParams & Partial<Record<K, V>>, TBuilt | K> {
    const newBuilder = new VoiceIntentBuilder<
      TParams & Partial<Record<K, V>>,
      TBuilt | K
    >();
    Object.assign(newBuilder, this);
    const parameter: VoiceParameter = {
      name,
      type: config.type,
      required: false,
      defaultValue: config.defaultValue,
      prompt: config.prompt,
      choices: config.choices as string[] | undefined,
      parser: config.parser,
    };
    newBuilder.parameters.push(parameter);
    return newBuilder;
  }

  withHandler<R>(
    handler: IntentHandler<TParams, R>
  ): VoiceIntentFinal<TParams, R> {
    this.handler = handler;
    return new VoiceIntentFinal(this as any);
  }

  configureIOS(configurator: (ios: IOSConfigurator) => IOSConfigurator): this {
    const iosConfigurator = new IOSConfigurator();
    const configured = configurator(iosConfigurator);
    this.iosConfig = configured.build();
    return this;
  }

  configureAndroid(
    configurator: (android: AndroidConfigurator) => AndroidConfigurator
  ): this {
    const androidConfigurator = new AndroidConfigurator();
    const configured = configurator(androidConfigurator);
    this.androidConfig = configured.build();
    return this;
  }

  build(): VoiceIntent<TParams, any> {
    if (!this.id) {
      throw new Error("Intent ID is required");
    }
    if (!this.handler) {
      throw new Error("Intent handler is required");
    }

    return {
      id: this.id,
      category: this.category,
      parameters: this.parameters,
      handler: this.handler,
      platforms: {
        ios: this.iosConfig,
        android: this.androidConfig,
      },
    };
  }
}

export class VoiceIntentFinal<TParams, TResponse> {
  constructor(private builder: VoiceIntentBuilder<TParams, keyof TParams>) {}

  configureIOS(configurator: (ios: IOSConfigurator) => IOSConfigurator): this {
    this.builder.configureIOS(configurator);
    return this;
  }

  configureAndroid(
    configurator: (android: AndroidConfigurator) => AndroidConfigurator
  ): this {
    this.builder.configureAndroid(configurator);
    return this;
  }

  withBackgroundExecution(): this {
    this.builder.configureIOS((ios) => ios.withBackgroundExecution());
    this.builder.configureAndroid((android) =>
      android.withDeferredFulfillment()
    );
    return this;
  }

  withMediaSessionIntegration(): this {
    this.builder.configureIOS((ios) => ios.withMediaSessionSupport());
    this.builder.configureAndroid((android) =>
      android.withMediaSessionSupport()
    );
    return this;
  }

  build(): VoiceIntent<TParams, TResponse> {
    return this.builder.build();
  }
}

export class IOSConfigurator {
  private config: {
    siriKitDomain?: string;
    appIntentSchema?: string;
    phrases: string[];
    requiresUnlock?: boolean;
  } = { phrases: [] };

  withSiriKitDomain(domain: string): this {
    this.config.siriKitDomain = domain;
    return this;
  }

  withAppIntentSchema(schema: string): this {
    this.config.appIntentSchema = schema;
    return this;
  }

  addSiriPhrase(phrase: string): this {
    this.config.phrases.push(phrase);
    return this;
  }

  withHealthKitIntegration(): this {
    this.config.siriKitDomain = "INWorkoutsDomain";
    return this;
  }

  withCallKitSupport(): this {
    this.config.siriKitDomain = "INStartAudioCallIntent";
    return this;
  }

  withMediaSessionSupport(): this {
    this.config.siriKitDomain = "INPlayMediaIntent";
    return this;
  }

  withBackgroundExecution(): this {
    this.config.requiresUnlock = false;
    return this;
  }

  requiresUnlock(): this {
    this.config.requiresUnlock = true;
    return this;
  }

  build() {
    return this.config;
  }
}

export class AndroidConfigurator {
  private config: {
    biiCategory?: string;
    capability: string;
    parameters: AndroidParameter[];
    fulfillment?: "INLINE" | "DEFERRED";
  } = { capability: "", parameters: [] };

  withBiiCategory(category: string): this {
    this.config.biiCategory = category;
    return this;
  }

  withCapability(capability: string): this {
    this.config.capability = capability;
    return this;
  }

  addParameter(param: AndroidParameter): this {
    this.config.parameters.push(param);
    return this;
  }

  withGoogleFitIntegration(): this {
    this.config.biiCategory = "Health & Fitness";
    return this;
  }

  withMediaSessionSupport(): this {
    this.config.capability = "actions.intent.PLAY_MEDIA";
    return this;
  }

  addAppActionPhrase(phrase: string): this {
    return this;
  }

  withDeferredFulfillment(): this {
    this.config.fulfillment = "DEFERRED";
    return this;
  }

  build() {
    return this.config;
  }
}

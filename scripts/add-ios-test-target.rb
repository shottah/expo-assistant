#!/usr/bin/env ruby
# Wires up iOS XCTest execution after `expo prebuild --platform ios`.
#
# Two pieces are needed for the package's `s.test_spec` to actually run:
#
#   1. The example app's xcodeproj needs a `ExpoAssistantTests` unit
#      test bundle target. CocoaPods can't create app-level test targets
#      from a Podfile alone — the target must exist in the project file
#      so that the Podfile `target 'ExpoAssistantTests' do ... end`
#      block has something to bind to.
#
#   2. The Podfile needs an explicit
#      `target 'ExpoAssistantTests' do ... testspecs => ['Tests'] end`
#      block. Autolinking installs `ExpoAssistant` into the main app
#      target but strips test_specs from autolinked pods; the test_spec
#      only gets installed when declared explicitly.
#
# Run after `bunx expo prebuild --platform ios` and BEFORE `pod install`:
#
#   ruby scripts/add-ios-test-target.rb
#   cd example/ios && pod install
#
# Idempotent — safe to re-run.

require "xcodeproj"

REPO_ROOT = File.expand_path("..", __dir__)
PROJECT_PATH = File.join(REPO_ROOT, "example/ios/expoassistantexample.xcodeproj")
PODFILE_PATH = File.join(REPO_ROOT, "example/ios/Podfile")
TARGET_NAME = "ExpoAssistantTests"
APP_TARGET_NAME = "expoassistantexample"

# --- 1. add unit test target to xcodeproj ---

project = Xcodeproj::Project.open(PROJECT_PATH)

if project.targets.any? { |t| t.name == TARGET_NAME }
  puts "✓ target #{TARGET_NAME} already in #{File.basename(PROJECT_PATH)}"
else
  app_target = project.targets.find { |t| t.name == APP_TARGET_NAME }
  raise "no #{APP_TARGET_NAME} target found in #{PROJECT_PATH}" unless app_target

  test_target = project.new_target(
    :unit_test_bundle,
    TARGET_NAME,
    :ios,
    "15.1",
    nil,
    :swift
  )

  test_target.build_configurations.each do |config|
    config.build_settings["TEST_HOST"] =
      "$(BUILT_PRODUCTS_DIR)/#{APP_TARGET_NAME}.app/#{APP_TARGET_NAME}"
    config.build_settings["BUNDLE_LOADER"] = "$(TEST_HOST)"
    config.build_settings["IPHONEOS_DEPLOYMENT_TARGET"] = "15.1"
    config.build_settings["SWIFT_VERSION"] = "5.9"
    config.build_settings["CODE_SIGNING_ALLOWED"] = "NO"
  end

  test_target.add_dependency(app_target)
  project.save
  puts "✓ added target #{TARGET_NAME} to #{File.basename(PROJECT_PATH)}"
end

# --- 2. append test target block to Podfile ---

podfile = File.read(PODFILE_PATH)
test_block = <<~RUBY

  target '#{TARGET_NAME}' do
    inherit! :complete
    pod 'ExpoAssistant', :path => '../../ios', :testspecs => ['Tests']
  end
RUBY

if podfile.include?("target '#{TARGET_NAME}'")
  puts "✓ #{TARGET_NAME} target already declared in Podfile"
else
  File.write(PODFILE_PATH, podfile + test_block)
  puts "✓ appended #{TARGET_NAME} target to Podfile"
end

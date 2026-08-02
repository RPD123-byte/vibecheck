#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <node_api.h>

namespace {

constexpr int64_t kSyntheticEventMarker = 0x5649424543484543;
constexpr NSTimeInterval kPasteStageDelay = 0.45;
NSString *const kBundlePasteboardType =
    @"com.rithvikprakki.vibecheck.component-reactions.bundle.v1";
NSString *const kMarkerPasteboardType =
    @"com.rithvikprakki.vibecheck.component-reactions.marker";

CFMachPortRef event_tap = nullptr;
CFRunLoopSourceRef run_loop_source = nullptr;
bool enabled = false;
bool expanding = false;

void Throw(napi_env env, NSString *message) {
  napi_throw_error(env, nullptr, message.UTF8String);
}

bool IsPhysicalCommandV(CGEventRef event) {
  const auto flags = CGEventGetFlags(event);
  return CGEventGetIntegerValueField(event, kCGEventSourceUserData) !=
             kSyntheticEventMarker &&
         CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) == 9 &&
         (flags & kCGEventFlagMaskCommand) != 0 &&
         (flags & kCGEventFlagMaskControl) == 0 &&
         (flags & kCGEventFlagMaskAlternate) == 0 &&
         (flags & kCGEventFlagMaskShift) == 0;
}

NSDictionary *ReadBundle(NSData **encoded_bundle) {
  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  NSData *marker = [pasteboard dataForType:kMarkerPasteboardType];
  if (![marker isEqualToData:[NSData dataWithBytes:"\1" length:1]]) {
    return nil;
  }
  NSData *encoded = [pasteboard dataForType:kBundlePasteboardType];
  if (encoded == nil) {
    return nil;
  }
  NSError *error = nil;
  id decoded = [NSPropertyListSerialization propertyListWithData:encoded
                                                         options:0
                                                          format:nil
                                                           error:&error];
  if (error != nil || ![decoded isKindOfClass:NSDictionary.class]) {
    return nil;
  }
  NSDictionary *bundle = static_cast<NSDictionary *>(decoded);
  if (![bundle[@"version"] isEqual:@1] ||
      ![bundle[@"entries"] isKindOfClass:NSArray.class]) {
    return nil;
  }
  if (encoded_bundle != nullptr) {
    *encoded_bundle = encoded;
  }
  return bundle;
}

AXUIElementRef FocusedElement() {
  AXUIElementRef system = AXUIElementCreateSystemWide();
  CFTypeRef value = nullptr;
  const AXError result = AXUIElementCopyAttributeValue(
      system, kAXFocusedUIElementAttribute, &value);
  CFRelease(system);
  if (result != kAXErrorSuccess || value == nullptr ||
      CFGetTypeID(value) != AXUIElementGetTypeID()) {
    if (value != nullptr) {
      CFRelease(value);
    }
    return nullptr;
  }
  return static_cast<AXUIElementRef>(value);
}

void RestoreFocus(AXUIElementRef element) {
  if (element != nullptr) {
    AXUIElementSetAttributeValue(element, kAXFocusedAttribute, kCFBooleanTrue);
  }
}

void PostPaste() {
  CGEventSourceRef source =
      CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  if (source == nullptr) {
    return;
  }
  CGEventRef down = CGEventCreateKeyboardEvent(source, 9, true);
  CGEventRef up = CGEventCreateKeyboardEvent(source, 9, false);
  CFRelease(source);
  if (down == nullptr || up == nullptr) {
    if (down != nullptr) {
      CFRelease(down);
    }
    if (up != nullptr) {
      CFRelease(up);
    }
    return;
  }
  CGEventSetFlags(down, kCGEventFlagMaskCommand);
  CGEventSetFlags(up, kCGEventFlagMaskCommand);
  CGEventSetIntegerValueField(down, kCGEventSourceUserData,
                              kSyntheticEventMarker);
  CGEventSetIntegerValueField(up, kCGEventSourceUserData,
                              kSyntheticEventMarker);
  CGEventPost(kCGHIDEventTap, down);
  CGEventPost(kCGHIDEventTap, up);
  CFRelease(down);
  CFRelease(up);
}

void RunFor(NSTimeInterval interval) {
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:interval]];
}

void WriteText(NSString *text) {
  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  [pasteboard clearContents];
  [pasteboard setString:text forType:NSPasteboardTypeString];
}

void WritePNG(NSData *png) {
  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  [pasteboard clearContents];
  [pasteboard setData:png forType:NSPasteboardTypePNG];
}

void RestoreBundle(NSDictionary *bundle, NSData *encoded) {
  NSArray *entries = bundle[@"entries"];
  NSMutableArray<NSString *> *texts = [NSMutableArray array];
  NSData *last_png = nil;
  for (id value in entries) {
    if (![value isKindOfClass:NSDictionary.class]) {
      continue;
    }
    NSDictionary *entry = static_cast<NSDictionary *>(value);
    if ([entry[@"text"] isKindOfClass:NSString.class]) {
      [texts addObject:entry[@"text"]];
    }
    if ([entry[@"png"] isKindOfClass:NSData.class]) {
      last_png = entry[@"png"];
    }
  }
  NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
  [item setData:[NSData dataWithBytes:"\1" length:1]
        forType:kMarkerPasteboardType];
  [item setData:encoded
        forType:kBundlePasteboardType];
  [item setString:[texts componentsJoinedByString:@"\n\n"]
          forType:NSPasteboardTypeString];
  if (last_png != nil) {
    [item setData:last_png forType:NSPasteboardTypePNG];
  }
  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  [pasteboard clearContents];
  [pasteboard writeObjects:@[ item ]];
}

void ReplayBundle(NSDictionary *bundle, NSData *encoded,
                  AXUIElementRef focused) {
  @autoreleasepool {
    NSArray *entries = bundle[@"entries"];
    for (id value in entries) {
      if (![value isKindOfClass:NSDictionary.class]) {
        continue;
      }
      NSDictionary *entry = static_cast<NSDictionary *>(value);
      NSString *text = [entry[@"text"] isKindOfClass:NSString.class]
                           ? entry[@"text"]
                           : @"";
      NSData *png = [entry[@"png"] isKindOfClass:NSData.class]
                        ? entry[@"png"]
                        : nil;
      WriteText(text);
      RestoreFocus(focused);
      PostPaste();
      RunFor(kPasteStageDelay);
      if (png != nil) {
        WritePNG(png);
        RestoreFocus(focused);
        PostPaste();
        RunFor(kPasteStageDelay);
      }
    }
    RestoreBundle(bundle, encoded);
    if (focused != nullptr) {
      CFRelease(focused);
    }
    expanding = false;
  }
}

CGEventRef EventTapCallback(CGEventTapProxy, CGEventType type, CGEventRef event,
                            void *) {
  if (type == kCGEventTapDisabledByTimeout ||
      type == kCGEventTapDisabledByUserInput) {
    if (event_tap != nullptr && enabled) {
      CGEventTapEnable(event_tap, true);
    }
    return event;
  }
  if (type != kCGEventKeyDown || !enabled || expanding ||
      !IsPhysicalCommandV(event)) {
    return event;
  }
  NSData *encoded = nil;
  NSDictionary *bundle = ReadBundle(&encoded);
  if (bundle == nil || encoded == nil) {
    return event;
  }
  expanding = true;
  AXUIElementRef focused = FocusedElement();
  dispatch_async(dispatch_get_main_queue(), ^{
    ReplayBundle(bundle, encoded, focused);
  });
  return nullptr;
}

void Uninstall() {
  enabled = false;
  if (event_tap != nullptr) {
    CGEventTapEnable(event_tap, false);
  }
  if (run_loop_source != nullptr) {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), run_loop_source,
                          kCFRunLoopCommonModes);
    CFRelease(run_loop_source);
    run_loop_source = nullptr;
  }
  if (event_tap != nullptr) {
    CFRelease(event_tap);
    event_tap = nullptr;
  }
}

napi_value PermissionStatus(napi_env env, napi_callback_info) {
  napi_value result;
  const char *status = AXIsProcessTrusted() ? "granted" : "denied";
  napi_create_string_utf8(env, status, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value SetEnabled(napi_env env, napi_callback_info info) {
  size_t argument_count = 1;
  napi_value arguments[1];
  napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr);
  bool value = false;
  if (argument_count != 1 ||
      napi_get_value_bool(env, arguments[0], &value) != napi_ok) {
    Throw(env, @"setEnabled requires a boolean");
    return nullptr;
  }
  if (!value) {
    Uninstall();
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
  }
  if (!AXIsProcessTrusted()) {
    NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @YES};
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
    Throw(env, @"Accessibility permission is required");
    return nullptr;
  }
  if (!CGPreflightListenEventAccess()) {
    CGRequestListenEventAccess();
    Throw(env, @"Input Monitoring permission is required");
    return nullptr;
  }
  if (event_tap == nullptr) {
    const CGEventMask mask = CGEventMaskBit(kCGEventKeyDown);
    event_tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
                                 kCGEventTapOptionDefault, mask,
                                 EventTapCallback, nullptr);
    if (event_tap == nullptr) {
      Throw(env, @"Input Monitoring permission is required");
      return nullptr;
    }
    run_loop_source =
        CFMachPortCreateRunLoopSource(kCFAllocatorDefault, event_tap, 0);
    CFRunLoopAddSource(CFRunLoopGetMain(), run_loop_source,
                       kCFRunLoopCommonModes);
  }
  enabled = true;
  CGEventTapEnable(event_tap, true);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

void Cleanup(void *) { Uninstall(); }

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
      {"permissionStatus", nullptr, PermissionStatus, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"setEnabled", nullptr, SetEnabled, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, descriptors);
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)

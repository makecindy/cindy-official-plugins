// Hardware H.264 for the Android viewer.
//
// The Android Emulator writes each RGB888 screen frame into a file the viewer
// shares with it (gRPC streamScreenshot, MMAP transport). This helper maps that
// file read-only, converts the current frame to BGRA and encodes it with
// VideoToolbox. Output uses Baguette's AVCC envelope so the page reuses
// Baguette's decoder: 0x01 avcC description, 0x02 keyframe, 0x03 delta.
//
// stdin, one command per line:
//   open <bytes> <absolute path>     map the shared frame file
//   frame <width> <height> <key>     encode the mapped frame; key=1 forces IDR
// stdout, messages of [u32 BE length][type][payload]. Each frame command gets
// exactly one result: 0x02 keyframe (preceded by its 0x01 avcC description),
// 0x03 delta, or 0x00 when the frame was not encoded. The viewer sends the
// next frame only after a result, so at most one frame is in flight.
// It never writes the shared file and exits on end of input.
#import <Foundation/Foundation.h>
#import <Accelerate/Accelerate.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <VideoToolbox/VideoToolbox.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

static const uint8_t *frames = NULL;
static size_t mapped = 0;
static VTCompressionSessionRef session = NULL;
static int32_t sessionWidth = 0, sessionHeight = 0;
static int64_t frameIndex = 0;
static NSObject *outputLock;

static void writeAll(const void *bytes, size_t length) {
  const uint8_t *p = bytes;
  while (length) {
    ssize_t n = write(STDOUT_FILENO, p, length);
    if (n < 0) { if (errno == EINTR) continue; _exit(0); }  // viewer went away
    p += n; length -= (size_t)n;
  }
}

static void emit(uint8_t type, const void *first, size_t firstLength, const void *second, size_t secondLength) {
  @synchronized(outputLock) {
    uint8_t head[5];
    uint32_t length = htonl((uint32_t)(1 + firstLength + secondLength));
    memcpy(head, &length, 4);
    head[4] = type;
    writeAll(head, 5);
    if (firstLength) writeAll(first, firstLength);
    if (secondLength) writeAll(second, secondLength);
  }
}

static void skipped(void) { emit(0x00, NULL, 0, NULL, 0); }

static void encoded(void *ref, void *source, OSStatus status, VTEncodeInfoFlags flags, CMSampleBufferRef sample) {
  if (status != noErr || !sample || (flags & kVTEncodeInfo_FrameDropped)) { skipped(); return; }
  BOOL key = YES;
  CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sample, false);
  if (attachments && CFArrayGetCount(attachments)) {
    CFDictionaryRef first = CFArrayGetValueAtIndex(attachments, 0);
    CFBooleanRef notSync = CFDictionaryGetValue(first, kCMSampleAttachmentKey_NotSync);
    key = !(notSync && CFBooleanGetValue(notSync));
  }
  CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample);
  size_t length = block ? CMBlockBufferGetDataLength(block) : 0;
  NSMutableData *data = [NSMutableData dataWithLength:length];
  if (!length || CMBlockBufferCopyDataBytes(block, 0, length, data.mutableBytes) != kCMBlockBufferNoErr) { skipped(); return; }
  if (key) {
    CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sample);
    CFDictionaryRef atoms = format ? CMFormatDescriptionGetExtension(format, kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms) : NULL;
    CFDataRef avcC = atoms ? CFDictionaryGetValue(atoms, CFSTR("avcC")) : NULL;
    if (!avcC) { skipped(); return; }
    // The description precedes its keyframe inside one result so the viewer
    // can count exactly one result per frame command.
    @synchronized(outputLock) {
      emit(0x01, CFDataGetBytePtr(avcC), (size_t)CFDataGetLength(avcC), NULL, 0);
      emit(0x02, data.bytes, length, NULL, 0);
    }
    return;
  }
  emit(0x03, data.bytes, length, NULL, 0);
}

static void set(CFStringRef key, CFTypeRef value) {
  OSStatus status = VTSessionSetProperty(session, key, value);
  if (status != noErr) fprintf(stderr, "android-encoder: optional property %s unavailable (%d)\n", CFStringGetCStringPtr(key, kCFStringEncodingUTF8) ?: "?", (int)status);
}

static BOOL prepare(int32_t width, int32_t height) {
  if (session && width == sessionWidth && height == sessionHeight) return YES;
  if (session) {
    VTCompressionSessionCompleteFrames(session, kCMTimeInvalid);
    VTCompressionSessionInvalidate(session);
    CFRelease(session);
    session = NULL;
  }
  // Low-latency rate control (as Baguette's H.264) signals a minimal decoded
  // picture buffer; without it the browser's hardware decoder holds each
  // frame until the next one arrives, which stalls the last frame of a gesture.
  NSDictionary *spec = @{(__bridge NSString *)kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: @YES,
                         (__bridge NSString *)kVTVideoEncoderSpecification_EnableLowLatencyRateControl: @YES};
  NSDictionary *source = @{(__bridge NSString *)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
                           (__bridge NSString *)kCVPixelBufferWidthKey: @(width),
                           (__bridge NSString *)kCVPixelBufferHeightKey: @(height),
                           (__bridge NSString *)kCVPixelBufferIOSurfacePropertiesKey: @{}};
  OSStatus status = VTCompressionSessionCreate(NULL, width, height, kCMVideoCodecType_H264, (__bridge CFDictionaryRef)spec,
                                               (__bridge CFDictionaryRef)source, NULL, encoded, NULL, &session);
  if (status != noErr || !session) { fprintf(stderr, "android-encoder: cannot create H.264 session (%d)\n", (int)status); session = NULL; return NO; }
  set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
  set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel);
  set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
  set(kVTCompressionPropertyKey_AverageBitRate, (__bridge CFTypeRef)@(8000000));
  set(kVTCompressionPropertyKey_ExpectedFrameRate, (__bridge CFTypeRef)@(60));
  // Keyframes also come on demand (start, resize, settle, backpressure).
  set(kVTCompressionPropertyKey_MaxKeyFrameInterval, (__bridge CFTypeRef)@(300));
  VTCompressionSessionPrepareToEncodeFrames(session);
  sessionWidth = width;
  sessionHeight = height;
  return YES;
}

static void encodeFrame(int32_t width, int32_t height, BOOL forceKey) {
  if (!frames || width <= 0 || height <= 0 || width > 8192 || height > 8192 || (size_t)width * (size_t)height * 3 > mapped) { skipped(); return; }
  if (!prepare(width, height)) { skipped(); return; }
  CVPixelBufferPoolRef pool = VTCompressionSessionGetPixelBufferPool(session);
  CVPixelBufferRef buffer = NULL;
  if (!pool || CVPixelBufferPoolCreatePixelBuffer(NULL, pool, &buffer) != kCVReturnSuccess || !buffer) { skipped(); return; }
  CVPixelBufferLockBaseAddress(buffer, 0);
  vImage_Buffer from = {(void *)frames, (vImagePixelCount)height, (vImagePixelCount)width, (size_t)width * 3};
  vImage_Buffer to = {CVPixelBufferGetBaseAddress(buffer), (vImagePixelCount)height, (vImagePixelCount)width, CVPixelBufferGetBytesPerRow(buffer)};
  vImage_Error converted = vImageConvert_RGB888toBGRA8888(&from, NULL, 0xFF, &to, false, kvImageNoFlags);
  CVPixelBufferUnlockBaseAddress(buffer, 0);
  if (converted != kvImageNoError) { CVPixelBufferRelease(buffer); skipped(); return; }
  NSDictionary *options = forceKey ? @{(__bridge NSString *)kVTEncodeFrameOptionKey_ForceKeyFrame: @YES} : nil;
  OSStatus status = VTCompressionSessionEncodeFrame(session, buffer, CMTimeMake(frameIndex++, 60), kCMTimeInvalid,
                                                    (__bridge CFDictionaryRef)options, NULL, NULL);
  CVPixelBufferRelease(buffer);
  if (status != noErr) skipped();
}

static BOOL openFrames(const char *path, size_t bytes) {
  if (frames) { munmap((void *)frames, mapped); frames = NULL; mapped = 0; }
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return NO;
  struct stat info;
  if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || (size_t)info.st_size < bytes || bytes == 0) { close(fd); return NO; }
  void *map = mmap(NULL, bytes, PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  if (map == MAP_FAILED) return NO;
  frames = map;
  mapped = bytes;
  return YES;
}

int main(void) {
  @autoreleasepool {
    outputLock = [NSObject new];
    signal(SIGPIPE, SIG_IGN);
    char line[4352];
    while (fgets(line, sizeof line, stdin)) {
      @autoreleasepool {
        int width = 0, height = 0, key = 0;
        unsigned long long bytes = 0;
        char path[4097] = {0};
        if (sscanf(line, "frame %d %d %d", &width, &height, &key) == 3) encodeFrame(width, height, key == 1);
        else if (sscanf(line, "open %llu %4096[^\n]", &bytes, path) == 2) {
          if (!openFrames(path, (size_t)bytes)) { fprintf(stderr, "android-encoder: cannot map the frame file\n"); return 1; }
        } else { fprintf(stderr, "android-encoder: unknown command\n"); return 1; }
      }
    }
    if (session) {
      VTCompressionSessionCompleteFrames(session, kCMTimeInvalid);
      VTCompressionSessionInvalidate(session);
    }
  }
  return 0;
}

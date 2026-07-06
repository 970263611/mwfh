#include <napi.h>
#include "capture.h"

Napi::Value Start(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    std::string ret = Capture::Start();
    return Napi::String::New(env, ret);
}

Napi::Value Invoke(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    std::string ret = Capture::Invoke();
    return Napi::String::New(env, ret);
}

Napi::Value Stop(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    std::string ret = Capture::Stop();
    return Napi::String::New(env, ret);
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("start", Napi::Function::New(env, Start));
    exports.Set("invoke", Napi::Function::New(env, Invoke));
    exports.Set("stop", Napi::Function::New(env, Stop));
    return exports;
}

NODE_API_MODULE(capture_addon, Init)
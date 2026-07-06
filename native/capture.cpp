#include "capture.h"
#include <string>
#include <ctime>
#include <cstdio>


std::string Capture::Start()
{
    return "0";
}
std::string Capture::Invoke()
{
    return GetSimpleTime();
}
std::string Capture::Stop()
{
    return "1";
}

std::string GetSimpleTime()
{
    char buf[64];
    std::time_t t = std::time(nullptr);
    std::tm tm{};
#ifdef __APPLE__
    localtime_r(&t, &tm);
#else
    localtime_s(&tm, &t);
#endif
    std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tm);
    return std::string(buf);
}
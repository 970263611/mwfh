#ifndef CAPTURE_H
#define CAPTURE_H

#include <string>

class Capture
{
public:
    static std::string Start();
    static std::string Invoke();
    static std::string Stop();
};

std::string GetSimpleTime();

#endif
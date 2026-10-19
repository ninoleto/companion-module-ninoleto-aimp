#include "protocol.h"
#include <iostream>
#include <iterator>
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    std::string input((std::istreambuf_iterator<char>(std::cin)), {});
    std::string mode = argv[1];
    if (mode == "handshake") {
        auto h = protocol::CheckHandshake(input);
        std::cout << h.status << "\n" << h.key;
    } else if (mode == "decode") {
        protocol::Decoder decoder; protocol::Message message;
        if (decoder.Next(input, message) != protocol::Result::Message || message.opcode != 1) return 3;
        std::cout << message.payload;
    } else if (mode == "frame") std::cout << protocol::Frame(input);
    else return 2;
}

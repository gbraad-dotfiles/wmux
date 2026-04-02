cmake_minimum_required(VERSION 3.10)
project(wmux VERSION 1.0.0)

set(BINARY_NAME wmux)
set(GO_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR})
set(GO_BINARY ${CMAKE_CURRENT_BINARY_DIR}/${BINARY_NAME})

# Find Go
find_program(GO_EXECUTABLE go REQUIRED)

# Build target
add_custom_target(${BINARY_NAME} ALL
    COMMAND ${GO_EXECUTABLE} build -o ${GO_BINARY}
    WORKING_DIRECTORY ${GO_SOURCE_DIR}
    COMMENT "Building ${BINARY_NAME}"
)

# Install binary
install(PROGRAMS ${GO_BINARY}
    DESTINATION bin
)

# Install web assets
install(DIRECTORY public/
    DESTINATION share/${BINARY_NAME}/public
    FILES_MATCHING
    PATTERN "*.html"
    PATTERN "*.js"
    PATTERN "*.css"
    PATTERN "*.png"
    PATTERN "*.ttf"
    PATTERN "*.json"
)

# Install systemd service files
install(FILES
    ${CMAKE_CURRENT_SOURCE_DIR}/wmux@.service
    ${CMAKE_CURRENT_SOURCE_DIR}/wmux-multi@.service
    DESTINATION lib/systemd/system
)

# Create symlink for assets (service expects them at /usr/local/bin/public)
install(CODE "
    execute_process(COMMAND ${CMAKE_COMMAND} -E create_symlink
        \${CMAKE_INSTALL_PREFIX}/share/${BINARY_NAME}/public
        \${CMAKE_INSTALL_PREFIX}/bin/public
    )
")

# Clean target
add_custom_target(clean-all
    COMMAND ${CMAKE_COMMAND} -E remove ${GO_BINARY}
    COMMAND ${GO_EXECUTABLE} clean
    WORKING_DIRECTORY ${GO_SOURCE_DIR}
)

# Test target
add_custom_target(test
    COMMAND ${GO_EXECUTABLE} test -v ./...
    WORKING_DIRECTORY ${GO_SOURCE_DIR}
)

# RPM build target
add_custom_target(rpm
    COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/build-rpm.sh
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Building RPM package"
)

# Android build target
add_custom_target(android
    COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/build-android.sh
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Building Android APK"
)

# Version info
message(STATUS "wmux version: ${PROJECT_VERSION}")
message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "Install prefix: ${CMAKE_INSTALL_PREFIX}")

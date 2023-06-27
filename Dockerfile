ARG RUN

FROM node:18-alpine as builderenv

WORKDIR /app

# some packages require a build step
RUN apk update
RUN apk add --no-cache py3-setuptools \
  python3-dev \
  build-base \ 
  g++ \
  cairo-dev \
  jpeg-dev \
  pango-dev \
  giflib-dev

# install dependencies
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
RUN npm ci

# build the app
COPY . /app
RUN npm run build
RUN npm run test

# remove devDependencies, keep only used dependencies
RUN npm ci --only=production


########################## END OF BUILD STAGE ##########################

FROM node:18-alpine

RUN apk update
RUN apk add --no-cache tini \
  cairo \
  jpeg \
  pango \
  giflib

# NODE_ENV is used to configure some runtime options, like JSON logger
ENV NODE_ENV production

ARG COMMIT_HASH=local
ENV COMMIT_HASH=${COMMIT_HASH:-local}

WORKDIR /app
COPY --from=builderenv /app /app
# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
ENTRYPOINT ["/sbin/tini", "--"]
# Run the program under Tini
CMD [ "/usr/local/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]

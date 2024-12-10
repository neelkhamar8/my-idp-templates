/*
 * Copyright 2022 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  FormControl,
  MenuItem,
  Select,
  CircularProgress,
  FormLabel,
  Chip,
  Checkbox,
  Snackbar,
} from "@material-ui/core";
import {
  BackstageUserIdentity,
  discoveryApiRef,
  fetchApiRef,
  identityApiRef,
  useApi,
} from "@backstage/core-plugin-api";
import { ErrorPanel, Progress, SelectItem } from "@backstage/core-components";
import { useAsync } from "react-use";
import get from "lodash/get";
import sortBy from "lodash/sortBy";
import { OAuthConfig, selectFieldFromApiConfigSchema } from "./types";
import { Box, Button, FormHelperText, Typography } from "@material-ui/core";
import { useOauthSignIn } from "./useOauthSignIn";
import { renderString } from "nunjucks";
import { difference, isEqual } from "lodash";
import fromPairs from "lodash/fromPairs";
import isObject from "lodash/isObject";
import toPairs from "lodash/toPairs";
import {
  FieldExtensionComponentProps,
  FieldExtensionUiSchema,
} from "@backstage/plugin-scaffolder-react";
import CancelRounded from "@material-ui/icons/CancelRounded";
import Alert from "@material-ui/lab/Alert";

const renderOption = (input: any, context: object): any => {
  if (!input) {
    return input;
  }
  if (typeof input === "string") {
    return renderString(input, context);
  }
  if (Array.isArray(input)) {
    return input.map((item) => renderOption(item, context));
  }
  if (typeof input === "object") {
    return fromPairs(
      Object.keys(input).map((key) => [
        key as keyof typeof input,
        renderOption(input[key], context),
      ])
    );
  }
  return input;
};

export function extractParameterProperty(input: string): string[] {
  const regex = /{\{parameters\.(.*?)\}\}/g;
  const matches: string[] = [];
  let match;

  // Loop through all matches
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(input)) !== null) {
    matches.push(match[1]); // Capture the parameter property
  }

  return matches;
}

export function extractBody(input: string): string {
  let d = JSON.stringify(input);
  if (d.includes('{"{ parameters.')) {
    d = d.replace('{"{ parameters.', '"{{parameters.');
    d = d.replace(' }":null}', '}}"');
  }
  return d;
}

const SelectFieldFromApiComponent = (
  props: FieldExtensionComponentProps<string | string[]> & {
    token?: string;
  } & {
    uiSchema: FieldExtensionUiSchema<string | string[], unknown>;
    identity?: BackstageUserIdentity;
  }
) => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [localState, updateLocalState] = useState<any>();
  const [dropDownData, setDropDownData] = useState<SelectItem[] | undefined>();
  const { formContext, uiSchema, identity } = props;
  const isArrayField = props?.schema?.type === "array";
  const [hasFetched, setHasFetched] = useState(false);
  const [open, setOpen] = useState(false);
  const [apiError, showAPIError] = useState<
    { [key: string]: any } | undefined
  >();

  const optionsParsingState = selectFieldFromApiConfigSchema.safeParse(
    uiSchema["ui:options"]
  );
  let dependencyKeys = extractParameterProperty(
    (optionsParsingState as { [key: string]: any })?.data?.path
  );
  let request: any = optionsParsingState.data?.request;
  if (request?.headers?.body) {
    let stringData = extractBody(request?.headers?.body);
    request.headers.body = stringData;
    const dependencies = extractParameterProperty(stringData);
    if (dependencies?.length) {
      dependencyKeys = [...dependencyKeys, ...dependencies];
    }
  }
  const fetchData = useCallback(async () => {
    if (!optionsParsingState.success) {
      throw optionsParsingState.error;
    }

    const makeCall = Boolean(
      dependencyKeys.map((i) => formContext.formData[i]).filter((i) => i).length
    );

    if (!makeCall) {
      setHasFetched(true);
      setDropDownData([]);
      return;
    }

    const options = optionsParsingState.data;
    const baseUrl = await discoveryApi.getBaseUrl("");
    const headers: Record<string, string> = {};

    if (props.token) {
      headers.Authorization = `Bearer ${props.token}`;
    }
    let init = renderOption(options.params, {
      parameters: formContext.formData,
      identity,
    });

    if (Array.isArray(init)) {
      init = init.reduce((acc, val) => {
        if (isObject(val)) {
          acc.push(toPairs(val).flat());
        } else {
          acc.push(val);
        }
        return acc;
      }, []);
    }
    let body = undefined;
    const params = new URLSearchParams(init);

    if (makeCall) {
      try {
        const url = `${baseUrl}${renderOption(options.path, {
          parameters: formContext.formData,
        })}?${params}`;

        let config: any = { headers };

        if (request?.method) {
          config["method"] = request.method;
        }
        if (request?.headers?.body) {
          const renderedData = renderOption(request.headers.body, {
            parameters: formContext.formData,
          });
          config["body"] = renderedData;
        }
        if (request.headers) {
          config["headers"] = { ...config.headers, ...request.headers };
        }
        const response = await fetchApi.fetch(url, config);
        body = await response.json();
        if (response.status !== 200) {
          setOpen(true);
          showAPIError(body);
          body = [];
        }
      } catch (error) {
        setOpen(true);
        showAPIError(error as any);
      }
    }

    const array =
      (options.arraySelector
        ? get(
            body,
            renderOption(options.arraySelector, {
              parameters: formContext.formData,
            })
          )
        : body) || [];
    const constructedData = array?.map((item: unknown) => {
      let value: string | undefined;
      let label: string | undefined;

      if (options.valueSelector) {
        value = get(
          item,
          renderOption(options.valueSelector, {
            parameters: formContext.formData,
          })
        );
        label = options.labelSelector
          ? get(
              item,
              renderOption(options.labelSelector, {
                parameters: formContext.formData,
              })
            )
          : value;
      } else {
        if (!(typeof item === "string")) {
          throw new Error(
            `The item provided for the select drop down "${item}" is not a string`
          );
        }
        value = item;
        label = item;
      }

      if (!value) {
        throw new Error(`Failed to populate SelectFieldFromApi dropdown`);
      }

      return {
        value,
        label: label || value,
      };
    });
    setDropDownData(sortBy(constructedData, "label"));
  }, [
    discoveryApi,
    fetchApi,
    formContext.formData,
    identity,
    optionsParsingState,
    props.token,
    dependencyKeys,
  ]);

  const { error, loading } = useAsync(fetchData);

  const handleDropdownFocus = useCallback(() => {
    setTimeout(async () => {
      if (!hasFetched) {
        await fetchData();
        setHasFetched(true);
      }
    }, 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFetched, ...dependencyKeys.map((item) => formContext.formData[item])]);

  useEffect(() => {
    if (
      dependencyKeys.map((i) => formContext.formData[i]).filter((i) => i)
        .length ||
      (!dependencyKeys.map((i) => formContext.formData[i]).filter((i) => i)
        .length &&
        !!props.formContext.formData[props.name])
    ) {
      setHasFetched(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isEqual(props?.formContext?.formData[props.name], localState)) {
      updateLocalState(props?.formContext?.formData[props.name]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isEqual(props?.formData, localState)) {
      props.onChange(localState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props?.formData, props.onChange, localState]);

  useEffect(() => {
    if (
      hasFetched &&
      !dependencyKeys.map((i) => formContext.formData[i]).filter((i) => i)
        .length &&
      !!props.formContext.formData[props.name]
    ) {
      setHasFetched(false);
      // props.onChange(undefined);
      updateLocalState(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFetched]);

  useEffect(() => {
    if (hasFetched) {
      setHasFetched(false);
      // props.onChange(undefined);
      updateLocalState(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencyKeys.map((item) => formContext.formData[item])]);

  useEffect(() => {
    if (hasFetched) {
      const hasValue = isArrayField
        ? difference(
            props.formContext.formData[props.name],
            dropDownData?.map((item) => item.value) || []
          ).length === 0
        : dropDownData?.find(
            (item) => item.value === props.formContext.formData[props.name]
          );
      if (!hasValue) {
        updateLocalState(undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropDownData]);

  const {
    title = "Select",
    description = "",
    placeholder = "Select from results",
  } = optionsParsingState.success ? optionsParsingState.data : {};
  if (error) {
    return <ErrorPanel error={error} />;
  }

  if (!dropDownData && hasFetched) {
    return <Progress />;
  }

  const handleClose = () => {
    setOpen(false);
    showAPIError(undefined);
  };

  return (
    <FormControl
      margin="normal"
      required={props.required}
      error={(props?.rawErrors?.length || 0) > 0 && !props.formData}
    >
      <FormLabel>{title}</FormLabel>
      <Snackbar
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert onClose={handleClose} severity="error">
          <pre>{JSON.stringify(apiError, null, 2)}</pre>
        </Alert>
      </Snackbar>
      <Select
        value={localState || []}
        onFocus={handleDropdownFocus}
        onChange={(event: any) => {
          // props.onChange(event.target.value || []);
          updateLocalState(event.target.value || []);
        }}
        multiple={isArrayField}
        displayEmpty
        renderValue={(selected: any) => {
          if (!selected || (Array.isArray(selected) && selected.length === 0)) {
            return <em>{placeholder}</em>;
          }
          return isArrayField ? (
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                maxHeight: "fit-content",
                overflow: "visible",
              }}
            >
              {selected.map((value: any) => {
                const selectedItem = dropDownData?.find(
                  (item) => item.value === value
                );
                return (
                  <Chip
                    key={value}
                    label={selectedItem?.label}
                    deleteIcon={<CancelRounded />}
                    onDelete={() => {}}
                    clickable
                  />
                );
              })}
            </Box>
          ) : (
            selected
          );
        }}
        MenuProps={{
          anchorOrigin: {
            vertical: "bottom",
            horizontal: "left",
          },
          transformOrigin: {
            vertical: "top",
            horizontal: "left",
          },
          getContentAnchorEl: null,
        }}
      >
        {/* eslint-disable-next-line no-nested-ternary */}
        {loading || !hasFetched ? (
          <MenuItem disabled>
            <CircularProgress size={24} />
          </MenuItem>
        ) : isArrayField ? (
          dropDownData?.map((item) => (
            <MenuItem key={item.value} value={item.value}>
              <Checkbox
                key={`${item?.value}_${props?.formData?.includes(
                  item?.value as string
                )}`}
                checked={props?.formData?.includes(item?.value as string)}
              />
              {item.label}
            </MenuItem>
          ))
        ) : (
          dropDownData?.map((item) => (
            <MenuItem key={item.value} value={item.value}>
              {item.label}
            </MenuItem>
          ))
        )}
      </Select>
      <FormHelperText>{description}</FormHelperText>
    </FormControl>
  );
};

export const SelectFieldFromApiOauthWrapper = ({
  oauthConfig,
  ...props
}: FieldExtensionComponentProps<string | string[]> & {
  oauthConfig: OAuthConfig;
  identity?: BackstageUserIdentity;
}) => {
  const { token, loading, error, isSignedIn, showSignInModal } =
    useOauthSignIn(oauthConfig);

  if (loading && !isSignedIn) {
    return <Progress />;
  }
  if (error) {
    return <ErrorPanel error={error} />;
  }

  if (!props.uiSchema) {
    return <ErrorPanel error={new Error("No UI Schema defined")} />;
  }

  if (!isSignedIn || !token) {
    return (
      <Box height="100%" width="100%">
        <Box>
          <Typography variant="body2">
            <b>{props.uiSchema["ui:options"]?.title || props.name}</b>
          </Typography>
        </Box>
        <Box display="flex">
          <Box paddingRight={1}>
            <Typography>
              This input requires authentication with {oauthConfig.provider}
            </Typography>
          </Box>
          <Box>
            <Button
              variant="outlined"
              color="primary"
              onClick={showSignInModal}
              size="small"
            >
              Sign In
            </Button>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <SelectFieldFromApiComponent
      {...{ ...props, uiSchema: props.uiSchema }}
      token={token}
    />
  );
};

const SelectFieldFromApi = (
  props: FieldExtensionComponentProps<string | string[]>
) => {
  const identityApi = useApi(identityApiRef);
  const { loading, value: identity } = useAsync(async () => {
    return await identityApi.getBackstageIdentity();
  });
  if (!props.uiSchema) {
    return <ErrorPanel error={new Error("No UI Schema defined")} />;
  }
  const result = selectFieldFromApiConfigSchema.safeParse(
    props.uiSchema["ui:options"]
  );

  if (loading) {
    return <Progress />;
  }

  if (result.success && result.data.oauth) {
    return (
      <SelectFieldFromApiOauthWrapper
        identity={identity}
        oauthConfig={result.data.oauth}
        {...props}
      />
    );
  }
  return (
    <SelectFieldFromApiComponent
      {...{ ...props, uiSchema: props.uiSchema }}
      identity={identity}
    />
  );
};

export default SelectFieldFromApi;
